import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import * as companyService from '../services/company.service';
import * as userService from '../services/user.service';
import {
  ASSIGNABLE_USER_ROLES,
  LIST_USERS_DEFAULT_LIMIT,
  LIST_USERS_MAX_LIMIT,
} from '../services/user.service';
import { AppError } from '../utils/errors';

// companyId, canViewFinance, password and isActive are intentionally absent:
// Zod strips unknown keys, so a client cannot supply them. The company comes
// from the JWT and finance access is derived from the role.
const createUserSchema = z.object({
  email:            z.string().email(),
  firstName:        z.string().min(1).max(100),
  lastName:         z.string().min(1).max(100),
  role:             z.enum(ASSIGNABLE_USER_ROLES),
  phone:            z.string().max(30).optional(),
  consultantType:   z.enum(['engineer', 'architect', 'quantity_surveyor', 'other']).optional(),
  defaultProjectId: z.string().uuid().optional(),
  defaultSiteId:    z.string().uuid().optional(),
});

// Query strings arrive as text, so isActive accepts only the literal words
// 'true' / 'false' — anything else is a 422 rather than a silent truthy cast.
// super_admin is not a listable role for a tenant, so it is not a valid filter.
const listUsersQuerySchema = z.object({
  role: z.enum([
    'company_admin',
    'finance_officer',
    'project_manager',
    'site_supervisor',
    'contractor',
    'consultant',
    'worker',
    'viewer',
  ]).optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  search:   z.string().trim().min(1).max(100).optional(),
  limit:    z.coerce.number().int().min(1).max(LIST_USERS_MAX_LIMIT).default(LIST_USERS_DEFAULT_LIMIT),
  offset:   z.coerce.number().int().min(0).max(100_000).default(0),
});

const userIdParamsSchema = z.object({ id: z.string().uuid() });

// Only the status flag; anything else in the body is rejected outright so a
// client cannot believe it changed a role or company through this route.
const setUserStatusSchema = z.object({ isActive: z.boolean() }).strict();

const emptyBodySchema = z.object({}).strict();

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

  // GET /api/v1/companies/me/users — company_admin only
  fastify.get(
    '/me/users',
    { preHandler: [authenticate, requireRole('company_admin')] },
    async (request, reply) => {
      const parsed = listUsersQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const result = await userService.listCompanyUsers(request.user, parsed.data);
      return reply.send(result);
    },
  );

  // POST /api/v1/companies/me/users — company_admin only
  fastify.post(
    '/me/users',
    { preHandler: [authenticate, requireRole('company_admin')] },
    async (request, reply) => {
      const parsed = createUserSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      try {
        const result = await userService.createCompanyUser(parsed.data, request.user, {
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        });
        return reply.status(201).send(result);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // POST /api/v1/companies/me/users/:id/setup-link — company_admin only.
  // Re-issues a one-time setup link for a member who has never signed in.
  fastify.post(
    '/me/users/:id/setup-link',
    {
      preHandler: [authenticate, requireRole('company_admin')],
      config: { rateLimit: { max: 10, timeWindow: 15 * 60 * 1000 } },
    },
    async (request, reply) => {
      const params = userIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.status(404).send({ error: 'User not found', code: 'NOT_FOUND' });
      }
      // Nothing about the link is client-controlled, so any body field is refused.
      if (!emptyBodySchema.safeParse(request.body ?? {}).success) {
        return reply.status(422).send({ error: 'Validation failed', code: 'VALIDATION_ERROR' });
      }

      try {
        const result = await userService.reissueSetupLink(params.data.id, request.user, {
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
        });
        return reply.send(result);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  // PATCH /api/v1/companies/me/users/:id/status — company_admin only
  fastify.patch(
    '/me/users/:id/status',
    { preHandler: [authenticate, requireRole('company_admin')] },
    async (request, reply) => {
      const params = userIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        // A malformed id cannot exist in any company.
        return reply.status(404).send({ error: 'User not found', code: 'NOT_FOUND' });
      }
      const parsed = setUserStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }

      try {
        const result = await userService.setCompanyUserStatus(
          params.data.id,
          parsed.data.isActive,
          request.user,
          { ipAddress: request.ip, userAgent: request.headers['user-agent'] ?? null },
        );
        return reply.send(result);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );
}
