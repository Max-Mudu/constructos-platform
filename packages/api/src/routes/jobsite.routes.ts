import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireProjectAccess } from '../middleware/requireProjectAccess';
import * as jobsiteService from '../services/jobsite.service';
import { AppError } from '../utils/errors';

const createSiteSchema = z.object({
  name: z.string().min(1).max(255),
  address: z.string().optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

const updateSiteSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  address: z.string().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function jobsiteRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/v1/projects/:projectId/sites
  fastify.get(
    '/',
    { preHandler: [authenticate, requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId } = request.params as { projectId: string };
        const sites = await jobsiteService.listSites(projectId, request.user);
        return reply.send({ sites });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // POST /api/v1/projects/:projectId/sites — company_admin or project_manager
  fastify.post(
    '/',
    {
      preHandler: [
        authenticate,
        requireRole('company_admin', 'project_manager'),
        requireProjectAccess,
      ],
    },
    async (request, reply) => {
      const parsed = createSiteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      try {
        const { projectId } = request.params as { projectId: string };
        const site = await jobsiteService.createSite(projectId, parsed.data, request.user);
        return reply.status(201).send({ site });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // GET /api/v1/projects/:projectId/sites/:siteId
  fastify.get(
    '/:siteId',
    { preHandler: [authenticate, requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const site = await jobsiteService.getSite(siteId, projectId, request.user);
        return reply.send({ site });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // PATCH /api/v1/projects/:projectId/sites/:siteId — company_admin or project_manager
  fastify.patch(
    '/:siteId',
    {
      preHandler: [
        authenticate,
        requireRole('company_admin', 'project_manager'),
        requireProjectAccess,
      ],
    },
    async (request, reply) => {
      const parsed = updateSiteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const site = await jobsiteService.updateSite(siteId, projectId, parsed.data, request.user);
        return reply.send({ site });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // DELETE /api/v1/projects/:projectId/sites/:siteId — company_admin only
  fastify.delete(
    '/:siteId',
    {
      preHandler: [
        authenticate,
        requireRole('company_admin'),
        requireProjectAccess,
      ],
    },
    async (request, reply) => {
      try {
        const { projectId, siteId } = request.params as { projectId: string; siteId: string };
        const site = await jobsiteService.deactivateSite(siteId, projectId, request.user);
        return reply.send({ site });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );
}
