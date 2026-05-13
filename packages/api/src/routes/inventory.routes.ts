import { FastifyInstance } from 'fastify';
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
      } catch (err) { return handleError(err, reply); }
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
      } catch (err) { return handleError(err, reply); }
    },
  );
}
