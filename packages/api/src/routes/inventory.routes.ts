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
}
