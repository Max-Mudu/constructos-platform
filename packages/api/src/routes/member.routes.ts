import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireProjectAccess } from '../middleware/requireProjectAccess';
import * as memberService from '../services/member.service';
import { AppError } from '../utils/errors';

const addMemberSchema = z.object({
  userId: z.string().uuid(),
  siteId: z.string().uuid().optional(),
});

export async function memberRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/v1/projects/:projectId/members — company_admin or project_manager
  fastify.get(
    '/',
    {
      preHandler: [
        authenticate,
        requireRole('company_admin', 'project_manager'),
        requireProjectAccess,
      ],
    },
    async (request, reply) => {
      try {
        const { projectId } = request.params as { projectId: string };
        const members = await memberService.listMembers(projectId, request.user);
        return reply.send({ members });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // POST /api/v1/projects/:projectId/members — company_admin only
  fastify.post(
    '/',
    {
      preHandler: [
        authenticate,
        requireRole('company_admin'),
        requireProjectAccess,
      ],
    },
    async (request, reply) => {
      const parsed = addMemberSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      try {
        const { projectId } = request.params as { projectId: string };
        const member = await memberService.addMember(projectId, parsed.data, request.user);
        return reply.status(201).send({ member });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // DELETE /api/v1/projects/:projectId/members/:userId — company_admin only
  fastify.delete(
    '/:userId',
    {
      preHandler: [
        authenticate,
        requireRole('company_admin'),
        requireProjectAccess,
      ],
    },
    async (request, reply) => {
      try {
        const { projectId, userId } = request.params as { projectId: string; userId: string };
        await memberService.removeMember(projectId, userId, request.user);
        return reply.status(204).send();
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );
}
