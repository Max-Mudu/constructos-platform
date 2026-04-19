import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import * as companyService from '../services/company.service';
import { AppError } from '../utils/errors';

const updateCompanySchema = z.object({
  name: z.string().min(2).max(255).optional(),
  country: z.string().max(100).optional(),
  currency: z.string().length(3).optional(),
  timezone: z.string().max(100).optional(),
});

export async function companyRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/v1/companies/me — any authenticated user sees their company
  fastify.get(
    '/me',
    { preHandler: [authenticate] },
    async (request, reply) => {
      try {
        const company = await companyService.getCompany(request.user.companyId);
        return reply.send({ company });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // PATCH /api/v1/companies/me — company_admin only
  fastify.patch(
    '/me',
    { preHandler: [authenticate, requireRole('company_admin')] },
    async (request, reply) => {
      const parsed = updateCompanySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      try {
        const company = await companyService.updateCompany(
          request.user.companyId,
          parsed.data,
          request.user,
        );
        return reply.send({ company });
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );
}
