import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireProjectAccess } from '../middleware/requireProjectAccess';
import * as targetsService from '../services/targets.service';
import { handleError } from '../utils/errors';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  description:  z.string().min(1).max(500),
  targetValue:  z.number().positive(),
  targetUnit:   z.string().min(1).max(50),
  actualValue:  z.number().min(0).optional(),
  workerId:     z.string().uuid().optional(),
  notes:        z.string().max(2000).optional(),
});

const updateSchema = z.object({
  description:  z.string().min(1).max(500).optional(),
  targetValue:  z.number().positive().optional(),
  targetUnit:   z.string().min(1).max(50).optional(),
  actualValue:  z.number().min(0).nullish(),
  workerId:     z.string().uuid().nullish(),
  notes:        z.string().max(2000).nullish(),
});

// ─── Role groups ──────────────────────────────────────────────────────────────

const VIEW_ROLES    = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'] as const;
const WRITE_ROLES   = ['company_admin', 'project_manager', 'site_supervisor'] as const;
const APPROVE_ROLES = ['company_admin', 'project_manager', 'site_supervisor'] as const;
const DELETE_ROLES  = ['company_admin', 'project_manager'] as const;

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function targetsRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /projects/:projectId/sites/:siteId/targets
  // Query: date, startDate, endDate, workerId
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const q = request.query as Record<string, string>;
        const targets = await targetsService.listTargets(projectId, siteId, request.user, {
          date:      q['date'],
          startDate: q['startDate'],
          endDate:   q['endDate'],
          workerId:  q['workerId'],
        });
        return reply.send({ targets });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /projects/:projectId/sites/:siteId/targets/summary?date=YYYY-MM-DD
  fastify.get(
    '/summary',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const q = request.query as Record<string, string>;
        const date = q['date'] ?? new Date().toISOString().split('T')[0];
        const summary = await targetsService.getTargetSummary(
          projectId, siteId, request.user, date,
        );
        return reply.send({ summary, date });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /projects/:projectId/sites/:siteId/targets
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const target = await targetsService.createTarget(
          projectId, siteId, parsed.data, request.user,
        );
        return reply.status(201).send({ target });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /projects/:projectId/sites/:siteId/targets/:targetId
  fastify.get(
    '/:targetId',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, targetId } = request.params as {
          projectId: string; siteId: string; targetId: string;
        };
        const target = await targetsService.getTarget(targetId, projectId, siteId, request.user);
        return reply.send({ target });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // PATCH /projects/:projectId/sites/:siteId/targets/:targetId
  fastify.patch(
    '/:targetId',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId, siteId, targetId } = request.params as {
          projectId: string; siteId: string; targetId: string;
        };
        const target = await targetsService.updateTarget(
          targetId, projectId, siteId, parsed.data, request.user,
        );
        return reply.send({ target });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /projects/:projectId/sites/:siteId/targets/:targetId/approve
  fastify.post(
    '/:targetId/approve',
    { preHandler: [authenticate, requireRole(...APPROVE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, targetId } = request.params as {
          projectId: string; siteId: string; targetId: string;
        };
        const target = await targetsService.approveTarget(
          targetId, projectId, siteId, request.user,
        );
        return reply.send({ target });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /projects/:projectId/sites/:siteId/targets/:targetId
  fastify.delete(
    '/:targetId',
    { preHandler: [authenticate, requireRole(...DELETE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, targetId } = request.params as {
          projectId: string; siteId: string; targetId: string;
        };
        await targetsService.deleteTarget(targetId, projectId, siteId, request.user);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );
}
