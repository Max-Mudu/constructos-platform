import { prisma } from '../utils/prisma';
import { hashPassword, verifyPassword, hashToken, generateToken } from '../utils/hash';
import { UnauthorizedError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { UserRole } from '@prisma/client';
import { JwtPayload } from '../types';
import { FastifyInstance } from 'fastify';
import { env } from '../utils/env';

const MAX_FAILED_ATTEMPTS = 10;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_EXPIRES_DAYS = 7;

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

function buildJwtPayload(user: {
  id: string;
  email: string;
  role: UserRole;
  companyId: string;
  canViewFinance: boolean;
}): JwtPayload {
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
    canViewFinance: user.canViewFinance,
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
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user || !user.isActive) {
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
    include: { user: true },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    // If token was already revoked, this may indicate theft — revoke entire family
    if (stored && stored.revokedAt) {
      await prisma.refreshToken.updateMany({
        where: { userId: stored.userId },
        data: { revokedAt: new Date() },
      });
    }
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  if (!stored.user.isActive) {
    throw new UnauthorizedError('Account is deactivated');
  }

  // Rotate: revoke old token, issue new pair
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const tokens = await issueTokenPair(fastify, stored.user, ipAddress, userAgent);

  return {
    user: {
      id: stored.user.id,
      email: stored.user.email,
      firstName: stored.user.firstName,
      lastName: stored.user.lastName,
      role: stored.user.role,
      companyId: stored.user.companyId,
      canViewFinance: stored.user.canViewFinance,
      defaultProjectId: stored.user.defaultProjectId,
      defaultSiteId: stored.user.defaultSiteId,
    },
    tokens,
  };
}

export async function getMe(userId: string): Promise<AuthUser> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
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
    });
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      companyId: user.companyId,
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
  });

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    companyId: user.companyId,
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
  await prisma.refreshToken.updateMany({
    where: { userId, tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'logout',
      entityType: 'auth',
    },
  });
}

async function issueTokenPair(
  fastify: FastifyInstance,
  user: { id: string; email: string; role: UserRole; companyId: string; canViewFinance: boolean },
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
    },
  });

  return { accessToken, refreshToken: rawRefreshToken };
}
