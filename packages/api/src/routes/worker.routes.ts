import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireProjectAccess } from '../middleware/requireProjectAccess';
import * as workerService from '../services/worker.service';
import { handleError } from '../utils/errors';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const EMPLOYMENT_STATUSES = ['active', 'inactive', 'suspended'] as const;

const createWorkerSchema = z.object({
  firstName:            z.string().min(1).max(100),
  lastName:             z.string().min(1).max(100),
  email:                z.string().email().max(255).optional(),
  phone:                z.string().max(30).optional(),
  idNumber:             z.string().max(100).optional(),
  trade:                z.string().max(100).optional(),
  dailyWage:            z.number().positive().optional(),
  currency:             z.string().length(3).default('USD'),
  employmentStatus:     z.enum(EMPLOYMENT_STATUSES).default('active'),
  emergencyContactName:  z.string().max(100).optional(),
  emergencyContactPhone: z.string().max(30).optional(),
  notes:                z.string().max(2000).optional(),
});

const updateWorkerSchema = z.object({
  firstName:            z.string().min(1).max(100).optional(),
  lastName:             z.string().min(1).max(100).optional(),
  email:                z.string().email().max(255).nullish(),
  phone:                z.string().max(30).nullish(),
  idNumber:             z.string().max(100).nullish(),
  trade:                z.string().max(100).nullish(),
  dailyWage:            z.number().positive().nullish(),
  currency:             z.string().length(3).optional(),
  employmentStatus:     z.enum(EMPLOYMENT_STATUSES).optional(),
  emergencyContactName:  z.string().max(100).nullish(),
  emergencyContactPhone: z.string().max(30).nullish(),
  notes:                z.string().max(2000).nullish(),
});

const assignWorkerSchema = z.object({
  workerId: z.string().uuid(),
});

// ─── Role groups ──────────────────────────────────────────────────────────────

const VIEW_ROLES   = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'] as const;
const WRITE_ROLES  = ['company_admin', 'project_manager'] as const;
const DELETE_ROLES = ['company_admin'] as const;
const ASSIGN_ROLES = ['company_admin', 'project_manager'] as const;

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function workerRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /workers?search=&trade=&isActive=&siteId=&projectId=
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES)] },
    async (request, reply) => {
      try {
        const q = request.query as Record<string, string>;
        const workers = await workerService.listWorkers(request.user, {
          search:    q['search'],
          trade:     q['trade'],
          isActive:  q['isActive'] !== undefined ? q['isActive'] === 'true' : undefined,
          siteId:    q['siteId'],
          projectId: q['projectId'],
        });
        return reply.send({ workers });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /workers
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES)] },
    async (request, reply) => {
      const parsed = createWorkerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const worker = await workerService.createWorker(parsed.data, request.user);
        return reply.status(201).send({ worker });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /workers/:workerId
  fastify.get(
    '/:workerId',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES)] },
    async (request, reply) => {
      try {
        const { workerId } = request.params as { workerId: string };
        const worker = await workerService.getWorker(workerId, request.user);
        return reply.send({ worker });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // PATCH /workers/:workerId
  fastify.patch(
    '/:workerId',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES)] },
    async (request, reply) => {
      const parsed = updateWorkerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { workerId } = request.params as { workerId: string };
        const worker = await workerService.updateWorker(workerId, parsed.data, request.user);
        return reply.send({ worker });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /workers/:workerId  (soft-delete: marks inactive)
  fastify.delete(
    '/:workerId',
    { preHandler: [authenticate, requireRole(...DELETE_ROLES)] },
    async (request, reply) => {
      try {
        const { workerId } = request.params as { workerId: string };
        await workerService.deactivateWorker(workerId, request.user);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );
}

// ─── Worker assignment sub-routes (mounted under /projects/:projectId/sites/:siteId/workers) ─

export async function siteWorkerRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /projects/:projectId/sites/:siteId/workers
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const workers = await workerService.listSiteWorkers(projectId, siteId, request.user);
        return reply.send({ workers });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /projects/:projectId/sites/:siteId/workers  { workerId }
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole(...ASSIGN_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = assignWorkerSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const assignment = await workerService.assignWorkerToSite(
          projectId, siteId, parsed.data.workerId, request.user,
        );
        return reply.status(201).send({ assignment });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /projects/:projectId/sites/:siteId/workers/:workerId
  fastify.delete(
    '/:workerId',
    { preHandler: [authenticate, requireRole(...ASSIGN_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, workerId } = request.params as {
          projectId: string; siteId: string; workerId: string;
        };
        await workerService.removeWorkerFromSite(projectId, siteId, workerId, request.user);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );
}
