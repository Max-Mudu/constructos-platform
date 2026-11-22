import { prisma } from '../utils/prisma';
import { hashPassword, verifyPassword, hashToken, generateToken } from '../utils/hash';
import { UnauthorizedError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../types';
import { FastifyInstance } from 'fastify';
import { env } from '../utils/env';
import { emailService } from './email.service';
import { removeUserPushDevices } from './push.service';

/**
 * A refresh that lost a race to another refresh of the same, still-valid token
 * (the other one rotated it a moment earlier). Refused like any other, but the
 * route keeps the browser's cookie: it may already hold the new token the
 * winning request set.
 */
export class RefreshTokenSupersededError extends UnauthorizedError {
  constructor() {
    super('Invalid or expired refresh token');
  }
}

const MAX_FAILED_ATTEMPTS = 10;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_EXPIRES_DAYS = 7;

let dummyHash: Promise<string> | undefined;

/**
 * bcrypt hash of a random secret nobody knows. login() compares against it
 * for unknown or inactive emails so those answers cost the same bcrypt work
 * as a wrong password and response time does not reveal which emails exist.
 */
function dummyPasswordHash(): Promise<string> {
  return (dummyHash ??= hashPassword(generateToken(16)));
}

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  companyName: string;
  country?: string;
  currency?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface UpdateDefaultsInput {
  defaultProjectId: string | null;
  defaultSiteId: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  companyId: string;
  currency: string;
  canViewFinance: boolean;
  defaultProjectId: string | null;
  defaultSiteId: string | null;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .substring(0, 60);
}

async function generateUniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  let attempt = 1;
  while (await prisma.company.findUnique({ where: { slug } })) {
    slug = `${base}-${attempt++}`;
  }
  return slug;
}

interface TokenSubject {
  id: string;
  email: string;
  role: UserRole;
  companyId: string;
  canViewFinance: boolean;
  sessionVersion: number;
}

function buildJwtPayload(user: TokenSubject): JwtPayload {
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
    canViewFinance: user.canViewFinance,
    sv: user.sessionVersion,
  };
}

export async function register(
  fastify: FastifyInstance,
  input: RegisterInput,
): Promise<{ user: AuthUser; tokens: TokenPair }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new ConflictError('An account with this email already exists');
  }

  const passwordHash = await hashPassword(input.password);
  const slug = await generateUniqueSlug(input.companyName);

  const result = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: {
        name: input.companyName,
        slug,
        country: input.country,
        currency: input.currency ?? 'USD',
      },
    });

    const user = await tx.user.create({
      data: {
        companyId: company.id,
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        role: 'company_admin',
        canViewFinance: true, // Company admin always has finance access
        // Registration signs the founder in, so their account setup is complete.
        lastLoginAt: new Date(),
      },
    });

    const defaultProject = await tx.project.create({
      data: {
        companyId: company.id,
        name: `${input.companyName} Main Project`,
        status: 'active',
      },
    });

    const defaultSite = await tx.jobSite.create({
      data: {
        companyId: company.id,
        projectId: defaultProject.id,
        name: `${input.companyName} Main Site`,
        isActive: true,
      },
    });

    const updatedUser = await tx.user.update({
      where: { id: user.id },
      data: {
        defaultProjectId: defaultProject.id,
        defaultSiteId: defaultSite.id,
      },
    });

    await tx.auditLog.create({
      data: {
        companyId: company.id,
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: 'create',
        entityType: 'company',
        entityId: company.id,
        changesAfter: { companyName: company.name, userEmail: user.email },
      },
    });

    return { company, user: updatedUser };
  });

  const tokens = await issueTokenPair(fastify, result.user, null, null);

  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      role: result.user.role,
      companyId: result.user.companyId,
      currency: result.company.currency,
      canViewFinance: result.user.canViewFinance,
      defaultProjectId: result.user.defaultProjectId,
      defaultSiteId: result.user.defaultSiteId,
    },
    tokens,
  };
}

export async function login(
  fastify: FastifyInstance,
  input: LoginInput,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<{ user: AuthUser; tokens: TokenPair }> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { company: { select: { currency: true } } },
  });

  if (!user || !user.isActive) {
    await verifyPassword(input.password, await dummyPasswordHash());
    throw new UnauthorizedError('Invalid email or password');
  }

  // Check account lock
  if (user.lockedAt) {
    const lockExpiry = new Date(user.lockedAt.getTime() + LOCK_DURATION_MS);
    if (new Date() < lockExpiry) {
      throw new ForbiddenError('Account temporarily locked. Please try again later.');
    }
    // Lock expired — reset
    await prisma.user.update({
      where: { id: user.id },
      data: { lockedAt: null, failedLoginCount: 0 },
    });
  }

  const passwordValid = await verifyPassword(input.password, user.passwordHash);

  if (!passwordValid) {
    const newCount = user.failedLoginCount + 1;
    const shouldLock = newCount >= MAX_FAILED_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: newCount,
        lockedAt: shouldLock ? new Date() : null,
      },
    });
    await prisma.auditLog.create({
      data: {
        companyId: user.companyId,
        userId: user.id,
        userEmail: user.email,
        userRole: user.role,
        action: 'login',
        entityType: 'auth',
        changesAfter: { success: false, reason: 'invalid_password', attempt: newCount },
        ipAddress,
        userAgent,
      },
    });
    throw new UnauthorizedError('Invalid email or password');
  }

  // Successful login — reset failure count
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedAt: null,
      lastLoginAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      companyId: user.companyId,
      userId: user.id,
      userEmail: user.email,
      userRole: user.role,
      action: 'login',
      entityType: 'auth',
      changesAfter: { success: true },
      ipAddress,
      userAgent,
    },
  });

  const tokens = await issueTokenPair(fastify, user, ipAddress, userAgent);

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      companyId: user.companyId,
      currency: user.company.currency,
      canViewFinance: user.canViewFinance,
      defaultProjectId: user.defaultProjectId,
      defaultSiteId: user.defaultSiteId,
    },
    tokens,
  };
}

export async function refreshTokens(
  fastify: FastifyInstance,
  rawRefreshToken: string,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<{ user: AuthUser; tokens: TokenPair }> {
  const tokenHash = hashToken(rawRefreshToken);

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { include: { company: { select: { currency: true } } } } },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    // A revoked token presented again is always refused; it may indicate theft.
    if (stored && stored.revokedAt) {
      if (await sessionEndedDeliberately(stored)) {
        // Its session was already ended on purpose: refused, and the user's
        // current sessions are not touched.
        console.warn('[auth] refresh token from an already-ended session refused for userId:', stored.userId);
      } else {
        console.warn('[auth] refresh token reuse detected — ending all sessions for userId:', stored.userId);
        await endAllSessionsAfterReuse(stored.user);
      }
    }
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  if (!stored.user.isActive) {
    throw new UnauthorizedError('Account is deactivated');
  }

  // Issued before the user's sessions were last invalidated (for example a
  // deactivation that has since been reversed): never valid again.
  if (stored.sessionVersion !== stored.user.sessionVersion) {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  // Rotate: revoke the old token, then issue a new pair. The revoke is
  // conditional so that, of two concurrent requests carrying the same token,
  // only one wins; the other gets 401 instead of a second live token family.
  const rotated = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (rotated.count !== 1) {
    throw new RefreshTokenSupersededError();
  }

  const tokens = await issueTokenPair(fastify, stored.user, ipAddress, userAgent);

  return {
    user: {
      id: stored.user.id,
      email: stored.user.email,
      firstName: stored.user.firstName,
      lastName: stored.user.lastName,
      role: stored.user.role,
      companyId: stored.user.companyId,
      currency: stored.user.company.currency,
      canViewFinance: stored.user.canViewFinance,
      defaultProjectId: stored.user.defaultProjectId,
      defaultSiteId: stored.user.defaultSiteId,
    },
    tokens,
  };
}

/**
 * True only when the server recorded that the presented (revoked) token's
 * session was ended deliberately, so presenting it again says nothing about
 * the user's current sessions:
 *  - this very token was signed out (the logout audit row names its id), or
 *  - its session version was ended by a password reset or account setup, or
 *    by a deactivation (the audit row written in the same transaction names
 *    the version it ended).
 * Anything else is treated as reuse: a token revoked by rotation, a session
 * version ended because reuse was detected (suspected compromise), or a
 * version whose end is not on record.
 */
async function sessionEndedDeliberately(stored: {
  id: string; userId: string; sessionVersion: number;
  user: { id: string; companyId: string; sessionVersion: number };
}): Promise<boolean> {
  const signedOut = await prisma.auditLog.findFirst({
    where:  { userId: stored.userId, action: 'logout', entityType: 'auth', entityId: stored.id },
    select: { id: true },
  });
  if (signedOut) return true;

  if (stored.sessionVersion >= stored.user.sessionVersion) return false;
  const ended = { changesAfter: { path: ['sessionVersionEnded'], equals: stored.sessionVersion } };
  const endedOnPurpose = await prisma.auditLog.findFirst({
    where: {
      OR: [
        {
          userId: stored.user.id, action: 'update', entityType: 'auth',
          AND: [{ changesAfter: { path: ['event'], equals: 'password_reset_completed' } }, ended],
        },
        {
          companyId: stored.user.companyId, action: 'update', entityType: 'user', entityId: stored.user.id,
          AND: [{ changesAfter: { path: ['event'], equals: 'user_deactivated' } }, ended],
        },
      ],
    },
    select: { id: true },
  });
  return endedOnPurpose !== null;
}

/**
 * Reuse of a revoked refresh token ends every session of the user, in one
 * transaction: the session version is bumped (access tokens already issued
 * are refused by middleware/authenticate.ts from the next request on, and a
 * token pair minted by a refresh running concurrently carries the old version
 * and is refused too), every live refresh token is revoked, and the user's
 * registered push devices are removed. The audit row records counts and the
 * session version that ended, never a token. The user signs in again; the
 * app then registers the device again.
 */
async function endAllSessionsAfterReuse(user: {
  id: string; companyId: string; email: string; role: UserRole;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const bumped = await tx.user.update({
      where:  { id: user.id },
      data:   { sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    });
    const revoked = await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data:  { revokedAt: new Date() },
    });
    const pushDevicesRemoved = await removeUserPushDevices(tx, user.id, user.companyId);
    await tx.auditLog.create({
      data: {
        companyId:    user.companyId,
        userId:       user.id,
        userEmail:    user.email,
        userRole:     user.role,
        action:       'update',
        entityType:   'auth',
        changesAfter: {
          event:                'refresh_token_reuse_detected',
          refreshTokensRevoked: revoked.count,
          pushDevicesRemoved,
          sessionVersionEnded:  bumped.sessionVersion - 1,
        },
      },
    });
  });
}

export async function getMe(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { company: { select: { currency: true } } },
  });
  if (!user || !user.isActive) {
    throw new UnauthorizedError('User not found or inactive');
  }
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    companyId: user.companyId,
    currency: user.company.currency,
    canViewFinance: user.canViewFinance,
    defaultProjectId: user.defaultProjectId,
    defaultSiteId: user.defaultSiteId,
  };
}

export async function updateDefaults(
  userId: string,
  companyId: string,
  input: UpdateDefaultsInput,
): Promise<AuthUser> {
  if ((input.defaultProjectId === null) !== (input.defaultSiteId === null)) {
    throw new ValidationError(
      'Both defaultProjectId and defaultSiteId must be provided, or both must be null',
    );
  }

  if (input.defaultProjectId === null) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { defaultProjectId: null, defaultSiteId: null },
      include: { company: { select: { currency: true } } },
    });
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      companyId: user.companyId,
      currency: user.company.currency,
      canViewFinance: user.canViewFinance,
      defaultProjectId: null,
      defaultSiteId: null,
    };
  }

  const project = await prisma.project.findFirst({
    where: { id: input.defaultProjectId, companyId },
  });
  if (!project) {
    throw new NotFoundError('Project');
  }

  const site = await prisma.jobSite.findFirst({
    where: { id: input.defaultSiteId!, projectId: input.defaultProjectId, companyId },
  });
  if (!site) {
    throw new NotFoundError('Site');
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      defaultProjectId: input.defaultProjectId,
      defaultSiteId: input.defaultSiteId,
    },
    include: { company: { select: { currency: true } } },
  });

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    companyId: user.companyId,
    currency: user.company.currency,
    canViewFinance: user.canViewFinance,
    defaultProjectId: user.defaultProjectId,
    defaultSiteId: user.defaultSiteId,
  };
}

export async function logout(
  userId: string,
  rawRefreshToken: string,
): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  await prisma.$transaction(async (tx) => {
    const live = await tx.refreshToken.findFirst({
      where:  { userId, tokenHash, revokedAt: null },
      select: { id: true },
    });
    // Conditional, so a refresh rotating the same token at the same moment
    // wins or loses cleanly: only a token this sign-out revoked is recorded.
    const revoked = live
      ? await tx.refreshToken.updateMany({
          where: { id: live.id, revokedAt: null },
          data:  { revokedAt: new Date() },
        })
      : { count: 0 };
    await tx.auditLog.create({
      data: {
        userId,
        action: 'logout',
        entityType: 'auth',
        // The id of the refresh token this sign-out ended (a row id, never the
        // token): presenting that token again is then recognised as a session
        // that was already ended, not as reuse.
        ...(live && revoked.count === 1 && { entityId: live.id }),
      },
    });
  });
}

const RESET_TOKEN_EXPIRES_MINUTES = 60;

export async function requestPasswordReset(
  email: string,
): Promise<{ devLink?: string }> {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !user.isActive) {
    return {};
  }

  // Invalidate any live unused tokens before creating a fresh one
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  const rawToken  = generateToken(48);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRES_MINUTES * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt },
  });

  await prisma.auditLog.create({
    data: {
      companyId:    user.companyId,
      userId:       user.id,
      userEmail:    user.email,
      userRole:     user.role,
      action:       'update',
      entityType:   'auth',
      changesAfter: { event: 'password_reset_requested' },
    },
  });

  const resetLink = `${env.APP_URL}/reset-password?token=${rawToken}`;
  try {
    await emailService.sendPasswordResetEmail(email, resetLink);
  } catch {
    // Never surface delivery failures: a 500 that only registered addresses
    // can trigger would reveal which emails have accounts. email.service
    // errors are link-free; log only the user id (no address, no link).
    console.warn(`[auth] password reset email delivery failed for userId=${user.id}`);
  }

  if (!env.isProduction) {
    return { devLink: resetLink };
  }
  return {};
}

export async function resetPassword(
  rawToken: string,
  newPassword: string,
): Promise<void> {
  const tokenHash = hashToken(rawToken);

  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!resetToken || !resetToken.user.isActive) {
    throw new UnauthorizedError('Invalid or expired reset link');
  }
  if (resetToken.usedAt) {
    throw new UnauthorizedError('This reset link has already been used');
  }
  if (resetToken.expiresAt < new Date()) {
    throw new UnauthorizedError('This reset link has expired');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    // Claim the token atomically: the checks above ran before the (slow)
    // bcrypt hash, so two concurrent requests could both pass them. Only the
    // request whose conditional update matches the still-unused, unexpired
    // row may change the password.
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: resetToken.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new UnauthorizedError('This reset link has already been used');
    }

    // Bumping the session version ends every session issued under the old
    // password: access tokens fail in middleware/authenticate.ts and refresh
    // tokens fail in refresh(). A fresh login issues tokens under the new
    // version.
    const updated = await tx.user.update({
      where: { id: resetToken.userId },
      data: {
        passwordHash,
        failedLoginCount: 0,
        lockedAt: null,
        sessionVersion: { increment: 1 },
      },
      select: { sessionVersion: true },
    });

    await tx.refreshToken.updateMany({
      where: { userId: resetToken.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // Devices registered for notifications belong to the sessions that just
    // ended (this is also how an account setup link completes). The app
    // registers the device again at the next sign-in. Runs after the session
    // version bump above, so a registration racing this transaction either
    // committed before it (and is removed here) or is refused afterwards.
    const pushDevicesRemoved = await removeUserPushDevices(
      tx, resetToken.userId, resetToken.user.companyId,
    );

    await tx.auditLog.create({
      data: {
        companyId:    resetToken.user.companyId,
        userId:       resetToken.userId,
        userEmail:    resetToken.user.email,
        userRole:     resetToken.user.role,
        action:       'update',
        entityType:   'auth',
        // sessionVersionEnded: the sessions this reset ended, so a refresh
        // token from them presented later is refused without touching the
        // sessions started after the reset.
        changesAfter: {
          event: 'password_reset_completed',
          pushDevicesRemoved,
          sessionVersionEnded: updated.sessionVersion - 1,
        },
      },
    });
  });
}

async function issueTokenPair(
  fastify: FastifyInstance,
  user: TokenSubject,
  ipAddress: string | null,
  userAgent: string | null,
): Promise<TokenPair> {
  const payload = buildJwtPayload(user);
  const accessToken = fastify.jwt.sign(payload, { expiresIn: env.JWT_EXPIRES_IN });

  const rawRefreshToken = generateToken(48);
  const tokenHash = hashToken(rawRefreshToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRES_DAYS);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
      ipAddress,
      userAgent,
      sessionVersion: user.sessionVersion,
    },
  });

  return { accessToken, refreshToken: rawRefreshToken };
}
