import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireProjectAccess } from '../middleware/requireProjectAccess';
import * as projectService from '../services/project.service';
import { AppError } from '../utils/errors';

const projectStatusEnum = z.enum([
  'planning', 'active', 'on_hold', 'completed', 'archived',
]);

const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().max(50).optional(),
  description: z.string().optional(),
  status: projectStatusEnum.optional(),
  startDate: z.string().datetime({ offset: true }).optional()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  endDate: z.string().datetime({ offset: true }).optional()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  location: z.string().max(255).optional(),
});

const updateProjectSchema = createProjectSchema.partial().extend({
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
});

export async function projectRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/v1/projects — scoped list
  fastify.get(
    '/',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const projects = await projectService.listProjects(request.user);
        return reply.send({ projects });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // POST /api/v1/projects — company_admin only
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole('company_admin')] },
    async (request, reply) => {
      const parsed = createProjectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      try {
        const project = await projectService.createProject(parsed.data, request.user);
        return reply.status(201).send({ project });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // GET /api/v1/projects/:projectId — scoped
  fastify.get(
    '/:projectId',
    { preHandler: [authenticate, requireProjectAccess] },
    async (request, reply) => {
      try {
        const project = await projectService.getProject(
          (request.params as { projectId: string }).projectId,
          request.user,
        );
        return reply.send({ project });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // PATCH /api/v1/projects/:projectId — company_admin only
  fastify.patch(
    '/:projectId',
    { preHandler: [authenticate, requireRole('company_admin'), requireProjectAccess] },
    async (request, reply) => {
      const parsed = updateProjectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      try {
        const project = await projectService.updateProject(
          (request.params as { projectId: string }).projectId,
          parsed.data,
          request.user,
        );
        return reply.send({ project });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // DELETE /api/v1/projects/:projectId — company_admin only (soft archive)
  fastify.delete(
    '/:projectId',
    { preHandler: [authenticate, requireRole('company_admin'), requireProjectAccess] },
    async (request, reply) => {
      try {
        const project = await projectService.archiveProject(
          (request.params as { projectId: string }).projectId,
          request.user,
        );
        return reply.send({ project });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );
}
