import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireProjectAccess } from '../middleware/requireProjectAccess';
import * as inventoryService from '../services/inventory.service';
import { handleError } from '../utils/errors';

const VIEW_ROLES = [
  'company_admin',
  'project_manager',
  'site_supervisor',
  'finance_officer',
] as const;

const WRITE_ROLES = [
  'company_admin',
  'project_manager',
  'site_supervisor',
] as const;

const useInventorySchema = z.object({
  quantity:       z.number().positive('quantity must be greater than 0'),
  note:           z.string().optional(),
  usageReason:    z.string().optional(),
  workArea:       z.string().optional(),
  scheduleTaskId: z.string().uuid().optional(),
});

/**
 * Stock adjustments rewrite the book quantity (write-offs, count corrections,
 * found stock), so they sit with the managers rather than with everyone who
 * may record usage: site supervisors record usage but do not adjust.
 */
const ADJUST_ROLES = [
  'company_admin',
  'project_manager',
] as const;

/** At most 3 decimal places: the stock columns are Decimal(12,3). */
const threeDecimals = (n: number) => Math.abs(Math.round(n * 1000) - n * 1000) < 1e-6;

const adjustInventorySchema = z.object({
  direction: z.enum(['in', 'out'], { errorMap: () => ({ message: "direction must be 'in' or 'out'" }) }),
  quantity:  z.number({ invalid_type_error: 'quantity must be a number', required_error: 'quantity is required' })
    .positive('quantity must be greater than 0')
    .max(999_999_999, 'quantity is too large')
    .refine(threeDecimals, 'quantity can have at most 3 decimal places'),
  reason:    z.enum(inventoryService.ADJUSTMENT_REASONS, {
    errorMap: () => ({ message: `reason must be one of: ${inventoryService.ADJUSTMENT_REASONS.join(', ')}` }),
  }),
  note:      z.string().trim().max(1000, 'note must be 1000 characters or fewer').optional(),
}).strict().superRefine((body, ctx) => {
  if (body.reason === 'other' && !body.note) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: "A note is required when the reason is 'other'" });
  }
});

const updateThresholdSchema = z.object({
  lowStockThreshold: z.number().min(0, 'threshold must be 0 or greater').nullable(),
});

export async function inventoryRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /projects/:projectId/sites/:siteId/inventory
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const inventory = await inventoryService.listInventory(projectId, siteId, request.user);
        return reply.send({ inventory });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // GET /projects/:projectId/sites/:siteId/inventory/:inventoryId
  fastify.get(
    '/:inventoryId',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, inventoryId } = request.params as {
          projectId: string; siteId: string; inventoryId: string;
        };
        const item = await inventoryService.getInventoryItem(projectId, siteId, inventoryId, request.user);
        return reply.send({ item });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // PATCH /projects/:projectId/sites/:siteId/inventory/:inventoryId
  fastify.patch(
    '/:inventoryId',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, inventoryId } = request.params as {
          projectId: string; siteId: string; inventoryId: string;
        };
        const parsed = updateThresholdSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(422).send({ error: parsed.error.errors[0]?.message ?? 'Invalid request body', code: 'VALIDATION_ERROR' });
        }
        const item = await inventoryService.updateThreshold(
          projectId, siteId, inventoryId, parsed.data.lowStockThreshold, request.user,
        );
        return reply.send({ item });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /projects/:projectId/sites/:siteId/inventory/:inventoryId/use
  fastify.post(
    '/:inventoryId/use',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, inventoryId } = request.params as {
          projectId: string; siteId: string; inventoryId: string;
        };
        const parsed = useInventorySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(422).send({ error: parsed.error.errors[0]?.message ?? 'Invalid request body', code: 'VALIDATION_ERROR' });
        }
        const { quantity, note, usageReason, workArea, scheduleTaskId } = parsed.data;
        const item = await inventoryService.recordUsage(
          projectId, siteId, inventoryId, quantity, note, usageReason, workArea, scheduleTaskId, request.user,
        );
        return reply.send({ item });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );

  // POST /projects/:projectId/sites/:siteId/inventory/:inventoryId/adjust
  fastify.post(
    '/:inventoryId/adjust',
    { preHandler: [authenticate, requireRole(...ADJUST_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, inventoryId } = request.params as {
          projectId: string; siteId: string; inventoryId: string;
        };
        const parsed = adjustInventorySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(422).send({ error: parsed.error.errors[0]?.message ?? 'Invalid request body', code: 'VALIDATION_ERROR' });
        }
        const item = await inventoryService.adjustStock(
          projectId, siteId, inventoryId, parsed.data, request.user,
          { ip: request.ip, userAgent: request.headers['user-agent'] },
        );
        return reply.send({ item });
      } catch (err) {
        return handleError(err, reply);
      }
    },
  );
}
