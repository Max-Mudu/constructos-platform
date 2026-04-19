import { FastifyRequest, FastifyReply } from 'fastify';
import { UserRole } from '@prisma/client';
import { ForbiddenError } from '../utils/errors';
import { prisma } from '../utils/prisma';

/**
 * Returns a hook that allows only users with one of the specified roles.
 */
export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
      return;
    }
    if (!roles.includes(request.user.role)) {
      await prisma.auditLog.create({
        data: {
          companyId: request.user.companyId,
          userId: request.user.id,
          userEmail: request.user.email,
          userRole: request.user.role,
          action: 'permission_denied',
          entityType: 'route',
          entityId: request.url,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      });
      const error = new ForbiddenError('Insufficient permissions');
      reply.status(403).send({ error: error.message, code: error.code });
    }
  };
}

/**
 * Requires the user to have canViewFinance = true.
 * Used exclusively on private finance routes.
 */
export async function requireFinanceAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.user) {
    reply.status(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }
  if (!request.user.canViewFinance) {
    await prisma.auditLog.create({
      data: {
        companyId: request.user.companyId,
        userId: request.user.id,
        userEmail: request.user.email,
        userRole: request.user.role,
        action: 'permission_denied',
        entityType: 'finance',
        entityId: request.url,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      },
    });
    reply.status(403).send({ error: 'Finance access denied', code: 'FINANCE_ACCESS_DENIED' });
  } else {
    // Log every successful finance access
    await prisma.auditLog.create({
      data: {
        companyId: request.user.companyId,
        userId: request.user.id,
        userEmail: request.user.email,
        userRole: request.user.role,
        action: 'view_finance',
        entityType: 'finance',
        entityId: request.url,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      },
    });
  }
}
