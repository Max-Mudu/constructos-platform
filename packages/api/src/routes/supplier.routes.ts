import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import * as supplierService from '../services/supplier.service';
import { handleError } from '../utils/errors';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name:          z.string().min(1).max(255),
  contactPerson: z.string().max(255).optional(),
  email:         z.string().email().max(255).optional(),
  phone:         z.string().max(50).optional(),
  address:       z.string().max(500).optional(),
});

const updateSchema = z.object({
  name:          z.string().min(1).max(255).optional(),
  contactPerson: z.string().max(255).nullish(),
  email:         z.string().email().max(255).nullish(),
  phone:         z.string().max(50).nullish(),
  address:       z.string().max(500).nullish(),
  isActive:      z.boolean().optional(),
});

// Roles that can view suppliers
const VIEW_ROLES  = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'viewer'] as const;
// Roles that can create/update suppliers
const WRITE_ROLES = ['company_admin', 'project_manager', 'site_supervisor'] as const;
// Roles that can delete (soft) suppliers
const DELETE_ROLES = ['company_admin', 'project_manager'] as const;

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function supplierRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /suppliers?includeInactive=true
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES)] },
    async (request, reply) => {
      try {
        const { includeInactive } = request.query as { includeInactive?: string };
        const suppliers = await supplierService.listSuppliers(
          request.user,
          includeInactive === 'true',
        );
        return reply.send({ suppliers });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /suppliers
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES)] },
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
        const supplier = await supplierService.createSupplier(parsed.data, request.user);
        return reply.status(201).send({ supplier });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /suppliers/:supplierId
  fastify.get(
    '/:supplierId',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES)] },
    async (request, reply) => {
      try {
        const { supplierId } = request.params as { supplierId: string };
        const supplier = await supplierService.getSupplier(supplierId, request.user);
        return reply.send({ supplier });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // PATCH /suppliers/:supplierId
  fastify.patch(
    '/:supplierId',
    { preHandler: [authenticate, requireRole(...WRITE_ROLES)] },
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
        const { supplierId } = request.params as { supplierId: string };
        const supplier = await supplierService.updateSupplier(supplierId, parsed.data, request.user);
        return reply.send({ supplier });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /suppliers/:supplierId  (soft delete — marks inactive)
  fastify.delete(
    '/:supplierId',
    { preHandler: [authenticate, requireRole(...DELETE_ROLES)] },
    async (request, reply) => {
      try {
        const { supplierId } = request.params as { supplierId: string };
        await supplierService.deleteSupplier(supplierId, request.user);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );
}
