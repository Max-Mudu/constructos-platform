import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireProjectAccess } from '../middleware/requireProjectAccess';
import * as scheduleService from '../services/schedule.service';
import { handleError } from '../utils/errors';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const TASK_STATUSES = ['not_started', 'in_progress', 'delayed', 'blocked', 'completed'] as const;
const MILESTONE_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

const createPackageSchema = z.object({
  contractorId: z.string().uuid(),
  name:         z.string().min(1).max(300),
  description:  z.string().max(2000).optional(),
  area:         z.string().max(200).optional(),
  startDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const updatePackageSchema = z.object({
  name:        z.string().min(1).max(300).optional(),
  description: z.string().max(2000).nullish(),
  area:        z.string().max(200).nullish(),
  startDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  endDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  status:      z.enum(TASK_STATUSES).optional(),
});

const createTaskSchema = z.object({
  contractorId:      z.string().uuid(),
  workPackageId:     z.string().uuid().optional(),
  title:             z.string().min(1).max(500),
  description:       z.string().max(2000).optional(),
  area:              z.string().max(200).optional(),
  materialsRequired: z.string().max(2000).optional(),
  equipmentRequired: z.string().max(2000).optional(),
  plannedStartDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  plannedEndDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  plannedProgress:   z.number().min(0).max(100).optional(),
  dependsOnTaskIds:  z.array(z.string().uuid()).optional(),
});

const updateTaskSchema = z.object({
  workPackageId:     z.string().uuid().nullish(),
  title:             z.string().min(1).max(500).optional(),
  description:       z.string().max(2000).nullish(),
  area:              z.string().max(200).nullish(),
  materialsRequired: z.string().max(2000).nullish(),
  equipmentRequired: z.string().max(2000).nullish(),
  plannedStartDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  plannedEndDate:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  actualStartDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  actualEndDate:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  plannedProgress:   z.number().min(0).max(100).nullish(),
  actualProgress:    z.number().min(0).max(100).nullish(),
  status:            z.enum(TASK_STATUSES).optional(),
  delayReason:       z.string().max(1000).nullish(),
  comments:          z.string().max(2000).nullish(),
});

const createMilestoneSchema = z.object({
  name:        z.string().min(1).max(300),
  description: z.string().max(1000).optional(),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const updateMilestoneSchema = z.object({
  name:        z.string().min(1).max(300).optional(),
  description: z.string().max(1000).nullish(),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  actualDate:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  status:      z.enum(MILESTONE_STATUSES).optional(),
});

const depSchema = z.object({ dependsOnTaskId: z.string().uuid() });

const weeklyPlanSchema = z.object({
  contractorId:  z.string().uuid(),
  weekStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:         z.string().max(2000).optional(),
  items: z.array(z.object({
    taskId:      z.string().uuid(),
    plannedHours: z.number().min(0).max(168).optional(),
    notes:        z.string().max(500).optional(),
  })).min(1),
});

// ─── Role groups ──────────────────────────────────────────────────────────────

const VIEW_ROLES    = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'contractor', 'consultant'] as const;
const WRITE_ROLES   = ['company_admin', 'project_manager', 'contractor'] as const;
const PROGRESS_ROLES = ['company_admin', 'project_manager', 'site_supervisor', 'contractor'] as const;
const MANAGE_ROLES  = ['company_admin', 'project_manager'] as const;

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function scheduleRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Summary ────────────────────────────────────────────────────────────────

  // GET /summary
  fastify.get(
    '/summary',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const summary = await scheduleService.getScheduleSummary(projectId, siteId, request.user);
        return reply.send({ summary });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // ── Work Packages ──────────────────────────────────────────────────────────

  // GET /packages
  fastify.get(
    '/packages',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const q = request.query as Record<string, string>;
        const packages = await scheduleService.listWorkPackages(projectId, siteId, request.user, {
          contractorId: q['contractorId'],
          status: q['status'] as scheduleService.UpdateWorkPackageInput['status'],
        });
        return reply.send({ packages });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /packages
  fastify.post(
    '/packages',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = createPackageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      }
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const pkg = await scheduleService.createWorkPackage(projectId, siteId, parsed.data, request.user);
        return reply.status(201).send({ package: pkg });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /packages/:packageId
  fastify.get(
    '/packages/:packageId',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, packageId } = request.params as { projectId: string; siteId: string; packageId: string };
        const pkg = await scheduleService.getWorkPackage(packageId, projectId, siteId, request.user);
        return reply.send({ package: pkg });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // PATCH /packages/:packageId
  fastify.patch(
    '/packages/:packageId',
    { preHandler: [authenticate, requireRole(...PROGRESS_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = updatePackageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      }
      try {
        const { projectId, siteId, packageId } = request.params as { projectId: string; siteId: string; packageId: string };
        const pkg = await scheduleService.updateWorkPackage(packageId, projectId, siteId, parsed.data, request.user);
        return reply.send({ package: pkg });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /packages/:packageId
  fastify.delete(
    '/packages/:packageId',
    { preHandler: [authenticate, requireRole(...MANAGE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, packageId } = request.params as { projectId: string; siteId: string; packageId: string };
        await scheduleService.deleteWorkPackage(packageId, projectId, siteId, request.user);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );

  // ── Schedule Tasks ─────────────────────────────────────────────────────────

  // GET /tasks
  fastify.get(
    '/tasks',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const q = request.query as Record<string, string>;
        const tasks = await scheduleService.listTasks(projectId, siteId, request.user, {
          workPackageId: q['workPackageId'],
          contractorId:  q['contractorId'],
          status:        q['status'] as scheduleService.UpdateTaskInput['status'],
        });
        return reply.send({ tasks });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /tasks
  fastify.post(
    '/tasks',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = createTaskSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      }
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const task = await scheduleService.createTask(projectId, siteId, parsed.data, request.user);
        return reply.status(201).send({ task });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /tasks/:taskId
  fastify.get(
    '/tasks/:taskId',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, taskId } = request.params as { projectId: string; siteId: string; taskId: string };
        const task = await scheduleService.getTask(taskId, projectId, siteId, request.user);
        return reply.send({ task });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // PATCH /tasks/:taskId
  fastify.patch(
    '/tasks/:taskId',
    { preHandler: [authenticate, requireRole(...PROGRESS_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = updateTaskSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      }
      try {
        const { projectId, siteId, taskId } = request.params as { projectId: string; siteId: string; taskId: string };
        const task = await scheduleService.updateTask(taskId, projectId, siteId, parsed.data, request.user);
        return reply.send({ task });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /tasks/:taskId
  fastify.delete(
    '/tasks/:taskId',
    { preHandler: [authenticate, requireRole(...MANAGE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, taskId } = request.params as { projectId: string; siteId: string; taskId: string };
        await scheduleService.deleteTask(taskId, projectId, siteId, request.user);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );

  // ── Dependencies ───────────────────────────────────────────────────────────

  // POST /tasks/:taskId/dependencies
  fastify.post(
    '/tasks/:taskId/dependencies',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = depSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      }
      try {
        const { projectId, siteId, taskId } = request.params as { projectId: string; siteId: string; taskId: string };
        const dep = await scheduleService.addDependency(taskId, parsed.data.dependsOnTaskId, projectId, siteId, request.user);
        return reply.status(201).send({ dependency: dep });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /tasks/:taskId/dependencies/:depTaskId
  fastify.delete(
    '/tasks/:taskId/dependencies/:depTaskId',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, taskId, depTaskId } = request.params as {
          projectId: string; siteId: string; taskId: string; depTaskId: string;
        };
        await scheduleService.removeDependency(taskId, depTaskId, projectId, siteId, request.user);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );

  // ── Milestones ─────────────────────────────────────────────────────────────

  // GET /tasks/:taskId/milestones
  fastify.get(
    '/tasks/:taskId/milestones',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, taskId } = request.params as { projectId: string; siteId: string; taskId: string };
        const milestones = await scheduleService.listMilestones(taskId, projectId, siteId, request.user);
        return reply.send({ milestones });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /tasks/:taskId/milestones
  fastify.post(
    '/tasks/:taskId/milestones',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = createMilestoneSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      }
      try {
        const { projectId, siteId, taskId } = request.params as { projectId: string; siteId: string; taskId: string };
        const milestone = await scheduleService.createMilestone(taskId, projectId, siteId, parsed.data, request.user);
        return reply.status(201).send({ milestone });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // PATCH /tasks/:taskId/milestones/:milestoneId
  fastify.patch(
    '/tasks/:taskId/milestones/:milestoneId',
    { preHandler: [authenticate, requireRole(...PROGRESS_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = updateMilestoneSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      }
      try {
        const { projectId, siteId, taskId, milestoneId } = request.params as {
          projectId: string; siteId: string; taskId: string; milestoneId: string;
        };
        const milestone = await scheduleService.updateMilestone(
          milestoneId, taskId, projectId, siteId, parsed.data, request.user,
        );
        return reply.send({ milestone });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /tasks/:taskId/milestones/:milestoneId
  fastify.delete(
    '/tasks/:taskId/milestones/:milestoneId',
    { preHandler: [authenticate, requireRole(...MANAGE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, taskId, milestoneId } = request.params as {
          projectId: string; siteId: string; taskId: string; milestoneId: string;
        };
        await scheduleService.deleteMilestone(milestoneId, taskId, projectId, siteId, request.user);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );

  // ── Weekly Plans ───────────────────────────────────────────────────────────

  // GET /weekly-plans
  fastify.get(
    '/weekly-plans',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const q = request.query as Record<string, string>;
        const plans = await scheduleService.listWeeklyPlans(projectId, siteId, request.user, q['contractorId']);
        return reply.send({ plans });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /weekly-plans
  fastify.post(
    '/weekly-plans',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = weeklyPlanSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: parsed.error.flatten().fieldErrors });
      }
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const plan = await scheduleService.createWeeklyPlan(projectId, siteId, parsed.data, request.user);
        return reply.status(201).send({ plan });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /weekly-plans/:planId
  fastify.get(
    '/weekly-plans/:planId',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId, planId } = request.params as { projectId: string; siteId: string; planId: string };
        const plan = await scheduleService.getWeeklyPlan(planId, projectId, siteId, request.user);
        return reply.send({ plan });
      } catch (err) { return handleError(err, reply); }
    },
  );
}
