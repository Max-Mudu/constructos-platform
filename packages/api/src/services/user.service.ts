import { ConsultantType, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
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

// ─── List company users ──────────────────────────────────────────────────────

/** Hard ceiling on one page of the team list. */
export const LIST_USERS_MAX_LIMIT     = 200;
export const LIST_USERS_DEFAULT_LIMIT = 100;

export interface ListCompanyUsersFilters {
  role?:     UserRole;
  isActive?: boolean;
  search?:   string;
  limit?:    number;
  offset?:   number;
}

/**
 * Explicit allowlist for the team list. passwordHash, failedLoginCount,
 * lockedAt, lastLoginAt, canViewFinance internals and every token relation are
 * deliberately absent — adding a field here is a conscious API change.
 *
 * Related records carry their companyId so the service can drop any row that
 * does not belong to the caller's tenant (defence in depth: the foreign keys
 * are validated on write, but the read must not trust that alone).
 */
const LIST_USER_SELECT = {
  id:             true,
  email:          true,
  firstName:      true,
  lastName:       true,
  phone:          true,
  role:           true,
  consultantType: true,
  isActive:       true,
  createdAt:      true,
  defaultProject: { select: { id: true, name: true, companyId: true } },
  defaultSite:    { select: { id: true, name: true, companyId: true } },
} as const;

/**
 * Lists the users of the caller's company for the team-management screen.
 *
 * Tenant boundary: companyId comes from the verified JWT only. super_admin
 * accounts are platform-level and are never listed to a tenant admin.
 */
export async function listCompanyUsers(
  actor: RequestUser,
  filters: ListCompanyUsersFilters = {},
) {
  const companyId = actor.companyId;
  const limit  = Math.min(Math.max(filters.limit ?? LIST_USERS_DEFAULT_LIMIT, 1), LIST_USERS_MAX_LIMIT);
  const offset = Math.max(filters.offset ?? 0, 0);
  const search = filters.search?.trim();

  const where: Prisma.UserWhereInput = {
    companyId,
    role: filters.role && filters.role !== 'super_admin'
      ? filters.role
      : { not: 'super_admin' },
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName:  { contains: search, mode: 'insensitive' } },
            { email:     { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: {
        ...LIST_USER_SELECT,
        projectMembers: {
          where:   { companyId, removedAt: null },
          select:  {
            assignedAt: true,
            project: { select: { id: true, name: true, companyId: true } },
            site:    { select: { id: true, name: true, companyId: true } },
          },
          orderBy: { assignedAt: 'asc' },
        },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }, { email: 'asc' }, { id: 'asc' }],
      take: limit,
      skip: offset,
    }),
    prisma.user.count({ where }),
  ]);

  const own = <T extends { id: string; name: string; companyId: string }>(ref: T | null) =>
    ref && ref.companyId === companyId ? { id: ref.id, name: ref.name } : null;

  const users = rows.map((row) => ({
    id:             row.id,
    email:          row.email,
    firstName:      row.firstName,
    lastName:       row.lastName,
    phone:          row.phone,
    role:           row.role,
    consultantType: row.consultantType,
    isActive:       row.isActive,
    createdAt:      row.createdAt,
    defaultProject: own(row.defaultProject),
    defaultSite:    own(row.defaultSite),
    projectMemberships: row.projectMembers
      // A foreign project or site means corrupt data; drop the row rather
      // than misreport a site-scoped membership as project-wide.
      .filter((m) => m.project.companyId === companyId
        && (m.site === null || m.site.companyId === companyId))
      .map((m) => ({
        projectId:   m.project.id,
        projectName: m.project.name,
        siteId:      m.site?.id ?? null,
        siteName:    m.site?.name ?? null,
        assignedAt:  m.assignedAt,
      })),
  }));

  return { users, total, limit, offset };
}

// ─── Activate / deactivate ───────────────────────────────────────────────────

/** Public shape after a status change — same allowlist spirit as the list. */
const STATUS_USER_SELECT = {
  id:        true,
  email:     true,
  firstName: true,
  lastName:  true,
  role:      true,
  isActive:  true,
} as const;

/**
 * Activates or deactivates a user in the acting admin's company.
 *
 * Guarantees, all inside one transaction:
 *  - the actor must still be an ACTIVE company_admin of this company in the
 *    database (a JWT can outlive a deactivation or a role change, so the
 *    token's claims alone are not trusted for this operation);
 *  - the target must belong to the same company and must not be super_admin
 *    (anything else is indistinguishable from "not found");
 *  - an admin cannot deactivate themselves;
 *  - the last active company_admin cannot be deactivated. The active admin
 *    rows are locked FOR UPDATE first, so two admins deactivating each other
 *    concurrently serialise and the second one sees the first one's result;
 *  - deactivation revokes every live refresh token and invalidates every
 *    unused password-reset / setup token for the target (reset tokens are
 *    invalidated the same way requestPasswordReset does: usedAt = now), so a
 *    later reactivation cannot revive an old link.
 *
 * Idempotent: repeating a request returns 200 with `changed: false`. Repeated
 * deactivation still re-runs the revocation (a no-op when nothing is live);
 * the audit row is written only when the status actually changes.
 *
 * Access JWTs already issued stop working on the next request, because
 * middleware/authenticate.ts re-checks the user (active, same company) per request.
 *
 * Project access is a suspension, not a reset: project_members rows are not
 * touched in either direction. On reactivation the user gets back exactly the
 * memberships that are still active at that moment — any membership an admin
 * removed while the user was inactive stays removed, and a defaultProjectId /
 * defaultSiteId is only a preference that never grants access by itself
 * (requireProjectAccess checks the live membership on every request).
 * See tests/company-users-reactivation.test.ts.
 */
export async function setCompanyUserStatus(
  targetUserId: string,
  isActive: boolean,
  actor: RequestUser,
  context: RequestContext = {},
) {
  const companyId = actor.companyId;

  return prisma.$transaction(async (tx) => {
    // Lock this company's active admins in a stable order (avoids deadlocks
    // between concurrent status changes).
    const activeAdmins = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM users
      WHERE "companyId" = ${companyId}
        AND role = 'company_admin'::"UserRole"
        AND "isActive" = true
      ORDER BY id
      FOR UPDATE
    `;
    const activeAdminIds = new Set(activeAdmins.map((a) => a.id));

    if (!activeAdminIds.has(actor.id)) {
      throw new ForbiddenError('Insufficient permissions');
    }

    const target = await tx.user.findFirst({
      where:  { id: targetUserId, companyId, role: { not: 'super_admin' } },
      select: { ...STATUS_USER_SELECT },
    });
    if (!target) throw new NotFoundError('User');

    if (!isActive && target.id === actor.id) {
      throw new ConflictError('You cannot deactivate your own account');
    }

    if (!isActive && target.role === 'company_admin' && target.isActive) {
      const remaining = [...activeAdminIds].filter((id) => id !== target.id).length;
      if (remaining === 0) {
        throw new ConflictError('The last active company admin cannot be deactivated');
      }
    }

    const changed = target.isActive !== isActive;
    const now = new Date();

    const user = changed
      ? await tx.user.update({
          where:  { id: target.id },
          data:   { isActive },
          select: { ...STATUS_USER_SELECT },
        })
      : target;

    let refreshTokensRevoked = 0;
    let setupTokensInvalidated = 0;
    if (!isActive) {
      const revoked = await tx.refreshToken.updateMany({
        where: { userId: target.id, revokedAt: null },
        data:  { revokedAt: now },
      });
      const invalidated = await tx.passwordResetToken.updateMany({
        where: { userId: target.id, usedAt: null },
        data:  { usedAt: now },
      });
      refreshTokensRevoked   = revoked.count;
      setupTokensInvalidated = invalidated.count;
    }

    if (changed) {
      await tx.auditLog.create({
        data: {
          companyId,
          userId:        actor.id,
          userEmail:     actor.email,
          userRole:      actor.role,
          action:        'update',
          entityType:    'user',
          entityId:      target.id,
          changesBefore: { isActive: target.isActive },
          changesAfter:  {
            isActive,
            event: isActive ? 'user_reactivated' : 'user_deactivated',
            refreshTokensRevoked,
            setupTokensInvalidated,
          },
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
      });
    }

    return { user, changed, refreshTokensRevoked, setupTokensInvalidated };
  });
}
