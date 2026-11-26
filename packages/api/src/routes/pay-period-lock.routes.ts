import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import * as lockService from '../services/pay-period-lock.service';
import { handleError } from '../utils/errors';

// Pay-period lock (see services/pay-period-lock.service.ts). Close: company
// admins and finance officers; reopen: company admins only, with a reason.
// The service checks the same role lists again.

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const closeSchema  = z.object({ lockedThrough: DATE, reason: z.string().max(500).optional() });
const reopenSchema = z.object({ lockedThrough: DATE.nullable(), reason: z.string().min(1).max(500) });

// Anyone who can read labour may see the closed date (the screens need it).
const VIEW_ROLES = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'] as const;

function invalid(reply: import('fastify').FastifyReply, error: z.ZodError) {
  return reply.status(422).send({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.flatten().fieldErrors });
}

export async function payPeriodLockRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', { preHandler: [authenticate, requireRole(...VIEW_ROLES)] }, async (request, reply) => {
    try {
      return reply.send({ lock: await lockService.getPayPeriodLock(request.user) });
    } catch (err) { return handleError(err, reply); }
  });

  fastify.post('/close', { preHandler: [authenticate, requireRole(...lockService.PAY_PERIOD_CLOSE_ROLES)] }, async (request, reply) => {
    const parsed = closeSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      return reply.send({ lock: await lockService.closePayPeriod(request.user, parsed.data.lockedThrough, parsed.data.reason) });
    } catch (err) { return handleError(err, reply); }
  });

  fastify.post('/reopen', { preHandler: [authenticate, requireRole(...lockService.PAY_PERIOD_REOPEN_ROLES)] }, async (request, reply) => {
    const parsed = reopenSchema.safeParse(request.body);
    if (!parsed.success) return invalid(reply, parsed.error);
    try {
      return reply.send({ lock: await lockService.reopenPayPeriod(request.user, parsed.data.lockedThrough, parsed.data.reason) });
    } catch (err) { return handleError(err, reply); }
  });
}
