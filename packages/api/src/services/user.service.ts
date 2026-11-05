import { ConsultantType, UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { generateToken, hashPassword, hashToken } from '../utils/hash';
import { env } from '../utils/env';
import { RequestUser } from '../types';
import { emailService } from './email.service';

/**
 * Roles a company_admin may assign when creating a company user.
 *
 * Excluded deliberately:
 *  - super_admin: platform-level, must never be reachable from a tenant.
 *  - worker: Worker.userId links a platform login to a construction worker
 *    record, and `worker` is the one role that is neither company-wide nor
 *    project-assignable. Creating one here would produce an account with no
 *    usable access, so worker onboarding is handled separately.
 */
export const ASSIGNABLE_USER_ROLES = [
  'company_admin',
  'finance_officer',
  'project_manager',
  'site_supervisor',
  'contractor',
  'consultant',
  'viewer',
] as const;

/**
 * Mirrors COMPANY_WIDE_ROLES in middleware/requireProjectAccess: these roles
 * reach every project in their company without a project_members row. Every
 * other role is checked against that table, so a project-scoped user needs a
 * membership or their default project would 403 on every request.
 */
const COMPANY_WIDE_ROLES: UserRole[] = ['company_admin', 'finance_officer'];

/** Roles that carry finance visibility. Derived server-side, never supplied. */
const FINANCE_ROLES: UserRole[] = ['company_admin', 'finance_officer'];

/** Same window password recovery uses (auth.service RESET_TOKEN_EXPIRES_MINUTES). */
const SETUP_TOKEN_EXPIRES_MINUTES = 60;

/** Explicit allowlist — passwordHash and auth counters must never leave here. */
const CREATED_USER_SELECT = {
  id:               true,
  email:            true,
  firstName:        true,
  lastName:         true,
  phone:            true,
  role:             true,
  consultantType:   true,
  canViewFinance:   true,
  isActive:         true,
  defaultProjectId: true,
  defaultSiteId:    true,
  createdAt:        true,
} as const;

export interface CreateCompanyUserInput {
  email:             string;
  firstName:         string;
  lastName:          string;
  role:              UserRole;
  phone?:            string;
  consultantType?:   ConsultantType;
  defaultProjectId?: string;
  defaultSiteId?:    string;
}

export interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Creates a user inside the acting admin's company.
 *
 * The new user gets a random password nobody ever sees; they choose their own
 * through a one-time setup link built on the existing password-reset token.
 * The admin therefore never learns the user's credentials.
 */
export async function createCompanyUser(
  input: CreateCompanyUserInput,
  actor: RequestUser,
  context: RequestContext = {},
) {
  // Tenant boundary: the company always comes from the verified JWT, never
  // from the request body.
  const companyId = actor.companyId;

  const existing = await prisma.user.findUnique({
    where:  { email: input.email },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError('An account with this email already exists');
  }

  const isCompanyWide = COMPANY_WIDE_ROLES.includes(input.role);
  const hasProject    = Boolean(input.defaultProjectId);
  const hasSite       = Boolean(input.defaultSiteId);

  // Project-scoped roles must land with usable access, so both ids are
  // mandatory for them in this slice.
  if (!isCompanyWide && !(hasProject && hasSite)) {
    throw new ValidationError(
      `Both defaultProjectId and defaultSiteId are required for role '${input.role}'`,
    );
  }

  // Whoever supplies one must supply the other — a project without a site
  // leaves the workspace shortcuts unresolvable.
  if (hasProject !== hasSite) {
    throw new ValidationError(
      'defaultProjectId and defaultSiteId must be provided together',
    );
  }

  let defaultProjectId: string | null = null;
  let defaultSiteId:    string | null = null;

  if (hasProject && hasSite) {
    // companyId is a predicate of the lookup itself, so another tenant's
    // project is indistinguishable from one that does not exist.
    const project = await prisma.project.findFirst({
      where:  { id: input.defaultProjectId!, companyId },
      select: { id: true },
    });
    if (!project) throw new NotFoundError('Project');

    // One query rejects all three bad cases at once: a foreign-company site,
    // a site from a different project, and a site outside this company.
    const site = await prisma.jobSite.findFirst({
      where:  { id: input.defaultSiteId!, projectId: project.id, companyId },
      select: { id: true },
    });
    if (!site) throw new NotFoundError('Site');

    defaultProjectId = project.id;
    defaultSiteId    = site.id;
  }

  const needsMembership = !isCompanyWide;
  const canViewFinance  = FINANCE_ROLES.includes(input.role);

  // Credential material is generated outside the transaction: bcrypt is slow
  // and must not hold a database transaction open. The plaintext below is
  // never returned, logged or stored — only its hash reaches the database.
  const throwawayPassword = generateToken(32);
  const passwordHash      = await hashPassword(throwawayPassword);
  const rawSetupToken     = generateToken(48);
  const setupTokenHash    = hashToken(rawSetupToken);
  const expiresAt         = new Date(Date.now() + SETUP_TOKEN_EXPIRES_MINUTES * 60 * 1000);

  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        companyId,
        email:          input.email,
        passwordHash,
        firstName:      input.firstName,
        lastName:       input.lastName,
        phone:          input.phone ?? null,
        role:           input.role,
        consultantType: input.consultantType ?? null,
        canViewFinance,
        defaultProjectId,
        defaultSiteId,
      },
      select: CREATED_USER_SELECT,
    });

    if (needsMembership) {
      await tx.projectMember.create({
        data: {
          companyId,
          projectId: defaultProjectId!,
          userId:    created.id,
          siteId:    defaultSiteId,
        },
      });
    }

    await tx.passwordResetToken.create({
      data: { userId: created.id, tokenHash: setupTokenHash, expiresAt },
    });

    await tx.auditLog.create({
      data: {
        companyId,
        userId:     actor.id,
        userEmail:  actor.email,
        userRole:   actor.role,
        action:     'create',
        entityType: 'user',
        entityId:   created.id,
        changesAfter: {
          email:                created.email,
          role:                 created.role,
          defaultProjectId,
          defaultSiteId,
          projectMemberCreated: needsMembership,
        },
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
    });

    return created;
  });

  // Same URL convention as password recovery. The raw token exists only here,
  // in the setup email, and (outside production only) in the admin's response.
  const setupLink = `${env.APP_URL}/reset-password?token=${rawSetupToken}`;

  // Delivery is best-effort: the user row is already committed, and an admin
  // can always recover a failed or expired setup through "Forgot password".
  // Failing the request here would leave a created user the admin believes
  // does not exist. The log line carries the user id only — never the link,
  // the token, or the SMTP error text (which may echo the message body).
  let setupEmailSent = false;
  try {
    setupEmailSent = await emailService.sendAccountSetupEmail(user.email, setupLink);
  } catch {
    console.warn(`[email] account setup email failed for userId=${user.id}; the user can use "Forgot password"`);
  }

  return env.isProduction
    ? { user, setupEmailSent }
    : { user, setupLink, setupEmailSent };
}
