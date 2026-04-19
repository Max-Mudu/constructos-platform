import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import * as contractorService from '../services/contractor.service';
import { handleError } from '../utils/errors';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name:                z.string().min(1).max(200),
  contactPerson:       z.string().max(200).optional(),
  email:               z.string().email().max(200).optional(),
  phone:               z.string().max(50).optional(),
  registrationNumber:  z.string().max(100).optional(),
  tradeSpecialization: z.string().max(200).optional(),
});

const updateSchema = z.object({
  name:                z.string().min(1).max(200).optional(),
  contactPerson:       z.string().max(200).nullish(),
  email:               z.string().email().max(200).nullish(),
  phone:               z.string().max(50).nullish(),
  registrationNumber:  z.string().max(100).nullish(),
  tradeSpecialization: z.string().max(200).nullish(),
  isActive:            z.boolean().optional(),
});

// ─── Role groups ──────────────────────────────────────────────────────────────

const VIEW_ROLES  = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'contractor', 'consultant'] as const;
const WRITE_ROLES = ['company_admin', 'project_manager'] as const;

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function contractorRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /contractors?isActive=&search=
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES)] },
    async (request, reply) => {
      try {
        const q = request.query as Record<string, string>;
        const isActive = q['isActive'] !== undefined
          ? q['isActive'] === 'true'
          : undefined;
        const contractors = await contractorService.listContractors(request.user, {
          isActive,
          search: q['search'],
        });
        return reply.send({ contractors });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /contractors/:contractorId
  fastify.get(
    '/:contractorId',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES)] },
    async (request, reply) => {
      try {
        const { contractorId } = request.params as { contractorId: string };
        const contractor = await contractorService.getContractor(contractorId, request.user);
        return reply.send({ contractor });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /contractors
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES)] },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error:   'Validation failed',
          code:    'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const contractor = await contractorService.createContractor(parsed.data, request.user);
        return reply.status(201).send({ contractor });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // PATCH /contractors/:contractorId
  fastify.patch(
    '/:contractorId',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES)] },
    async (request, reply) => {
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error:   'Validation failed',
          code:    'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { contractorId } = request.params as { contractorId: string };
        const contractor = await contractorService.updateContractor(
          contractorId, parsed.data, request.user,
        );
        return reply.send({ contractor });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /contractors/:contractorId  (soft-delete)
  fastify.delete(
    '/:contractorId',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES)] },
    async (request, reply) => {
      try {
        const { contractorId } = request.params as { contractorId: string };
        await contractorService.deleteContractor(contractorId, request.user);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );
}
