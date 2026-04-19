import { FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { prisma } from '../utils/prisma';
import { AuditAction } from '@prisma/client';

const METHOD_TO_ACTION: Record<string, AuditAction | undefined> = {
  POST: 'create',
  PUT: 'update',
  PATCH: 'update',
  DELETE: 'delete',
};

/**
 * Fastify onSend hook that logs all mutating API requests to audit_logs.
 * Read-only (GET) requests are not logged here — finance GET routes log explicitly.
 */
export async function auditLogHook(
  request: FastifyRequest,
  reply: FastifyReply,
  _payload: unknown,
  done: HookHandlerDoneFunction,
): Promise<void> {
  const action = METHOD_TO_ACTION[request.method];
  if (!action || !request.user) {
    done();
    return;
  }

  // Extract entity info from URL pattern: /api/v1/<entityType>/<entityId>
  const parts = request.url.split('/').filter(Boolean);
  const entityType = parts[2] ?? null;
  const entityId = parts[3] ?? null;

  try {
    await prisma.auditLog.create({
      data: {
        companyId: request.user.companyId,
        userId: request.user.id,
        userEmail: request.user.email,
        userRole: request.user.role,
        action,
        entityType,
        entityId,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        // changesAfter populated by individual services when needed
      },
    });
  } catch {
    // Audit log failure must never break the request
    // Log to stderr and continue
    process.stderr.write(`[audit] Failed to write audit log for ${request.method} ${request.url}\n`);
  }

  done();
}
