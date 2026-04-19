import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireProjectAccess } from '../middleware/requireProjectAccess';
import * as labourService from '../services/labour.service';
import { handleError } from '../utils/errors';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createEntrySchema = z.object({
  workerId:    z.string().uuid(),
  date:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  hoursWorked: z.number().positive().max(24),
  dailyRate:   z.number().positive(),
  currency:    z.string().length(3).default('USD'),
  notes:       z.string().max(2000).optional(),
});

const updateEntrySchema = z.object({
  hoursWorked: z.number().positive().max(24).optional(),
  dailyRate:   z.number().positive().optional(),
  currency:    z.string().length(3).optional(),
  notes:       z.string().max(2000).nullish(),
});

// ─── Role groups ──────────────────────────────────────────────────────────────

const VIEW_ROLES   = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'] as const;
const WRITE_ROLES  = ['company_admin', 'project_manager', 'site_supervisor'] as const;
const DELETE_ROLES = ['company_admin', 'project_manager'] as const;

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function labourRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /projects/:projectId/sites/:siteId/labour?date=&startDate=&endDate=&workerId=
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const q = request.query as Record<string, string>;
        const entries = await labourService.listLabourEntries(projectId, siteId, request.user, {
          date:      q['date'],
          startDate: q['startDate'],
          endDate:   q['endDate'],
          workerId:  q['workerId'],
        });
        return reply.send({ entries });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /projects/:projectId/sites/:siteId/labour
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = createEntrySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const entry = await labourService.createLabourEntry(projectId, siteId, parsed.data, request.user);
        return reply.status(201).send({ entry });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /projects/:projectId/sites/:siteId/labour/:entryId
  fastify.get(
    '/:entryId',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, entryId } = request.params as {
          projectId: string; siteId: string; entryId: string;
        };
        const entry = await labourService.getLabourEntry(entryId, projectId, siteId, request.user);
        return reply.send({ entry });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // PATCH /projects/:projectId/sites/:siteId/labour/:entryId
  fastify.patch(
    '/:entryId',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = updateEntrySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId, siteId, entryId } = request.params as {
          projectId: string; siteId: string; entryId: string;
        };
        const entry = await labourService.updateLabourEntry(
          entryId, projectId, siteId, parsed.data, request.user,
        );
        return reply.send({ entry });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /projects/:projectId/sites/:siteId/labour/:entryId
  fastify.delete(
    '/:entryId',
    { preHandler: [authenticate, requireRole(...DELETE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, entryId } = request.params as {
          projectId: string; siteId: string; entryId: string;
        };
        await labourService.deleteLabourEntry(entryId, projectId, siteId, request.user);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );
}
