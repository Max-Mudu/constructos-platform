import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireProjectAccess } from '../middleware/requireProjectAccess';
import * as instructionService from '../services/instruction.service';
import { handleError } from '../utils/errors';
import {
  storeFile,
  validateMagicBytes,
  ALLOWED_DOCUMENT_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '../services/upload.service';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const STATUSES   = ['open', 'acknowledged', 'in_progress', 'resolved', 'rejected'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
const TYPES      = ['instruction', 'recommendation'] as const;

const createInstructionSchema = z.object({
  type:            z.enum(TYPES),
  title:           z.string().min(1).max(500),
  category:        z.string().max(100).optional(),
  priority:        z.enum(PRIORITIES).optional(),
  description:     z.string().max(5000).optional(),
  issuedDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  targetActionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  siteId:          z.string().uuid().optional(),
  contractorId:    z.string().uuid().optional(),
  drawingId:       z.string().uuid().optional(),
  revisionId:      z.string().uuid().optional(),
  milestoneId:     z.string().uuid().optional(),
  workPackageId:   z.string().uuid().optional(),
});

const updateInstructionSchema = z.object({
  title:            z.string().min(1).max(500).optional(),
  category:         z.string().max(100).nullish(),
  priority:         z.enum(PRIORITIES).optional(),
  status:           z.enum(STATUSES).optional(),
  description:      z.string().max(5000).nullish(),
  targetActionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  siteId:           z.string().uuid().nullish(),
  contractorId:     z.string().uuid().nullish(),
  drawingId:        z.string().uuid().nullish(),
  revisionId:       z.string().uuid().nullish(),
  milestoneId:      z.string().uuid().nullish(),
  workPackageId:    z.string().uuid().nullish(),
  contractorResponse: z.string().max(5000).nullish(),
  resolutionNotes:  z.string().max(5000).nullish(),
});

// ─── Role groups ──────────────────────────────────────────────────────────────

const VIEW_ROLES   = ['company_admin', 'project_manager', 'site_supervisor',
                      'consultant', 'contractor', 'finance_officer', 'viewer'] as const;
const ISSUE_ROLES  = ['company_admin', 'project_manager', 'consultant'] as const;
const UPDATE_ROLES = ['company_admin', 'project_manager', 'site_supervisor',
                      'consultant', 'contractor'] as const;

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function instructionRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /projects/:projectId/instructions
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId } = request.params as { projectId: string };
        const q = request.query as Record<string, string>;
        const instructions = await instructionService.listInstructions(projectId, request.user, {
          status:       q['status']       as instructionService.UpdateInstructionInput['status'],
          priority:     q['priority']     as instructionService.CreateInstructionInput['priority'],
          type:         q['type']         as instructionService.CreateInstructionInput['type'],
          siteId:       q['siteId'],
          contractorId: q['contractorId'],
          issuedById:   q['issuedById'],
        });
        return reply.send({ instructions });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /projects/:projectId/instructions
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole(...ISSUE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = createInstructionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed', code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId } = request.params as { projectId: string };
        const instruction = await instructionService.createInstruction(projectId, parsed.data, request.user);
        return reply.status(201).send({ instruction });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /projects/:projectId/instructions/:instructionId
  fastify.get(
    '/:instructionId',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, instructionId } = request.params as { projectId: string; instructionId: string };
        const instruction = await instructionService.getInstruction(instructionId, projectId, request.user);
        return reply.send({ instruction });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // PATCH /projects/:projectId/instructions/:instructionId
  fastify.patch(
    '/:instructionId',
    { preHandler: [authenticate, requireRole(...UPDATE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = updateInstructionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed', code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId, instructionId } = request.params as { projectId: string; instructionId: string };
        const instruction = await instructionService.updateInstruction(
          instructionId, projectId, parsed.data, request.user,
        );
        return reply.send({ instruction });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // ── Attachments ────────────────────────────────────────────────────────────

  // POST /projects/:projectId/instructions/:instructionId/attachments (multipart)
  fastify.post(
    '/:instructionId/attachments',
    { preHandler: [authenticate, requireRole(...ISSUE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, instructionId } = request.params as { projectId: string; instructionId: string };

        const data = await request.file();
        if (!data) {
          return reply.status(422).send({ error: 'No file uploaded', code: 'VALIDATION_ERROR' });
        }

        const buffer = await data.toBuffer();

        if (buffer.length > MAX_FILE_SIZE_BYTES) {
          return reply.status(422).send({
            error: `File exceeds ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB limit`,
            code: 'FILE_TOO_LARGE',
          });
        }

        if (!ALLOWED_DOCUMENT_TYPES.has(data.mimetype)) {
          return reply.status(422).send({ error: 'Unsupported file type', code: 'INVALID_FILE_TYPE' });
        }

        if (!validateMagicBytes(buffer, data.mimetype)) {
          return reply.status(422).send({
            error: 'File content does not match declared type',
            code: 'INVALID_FILE_CONTENT',
          });
        }

        const stored = await storeFile(buffer, data.filename, data.mimetype, 'instructions');

        const attachment = await instructionService.addAttachment(
          instructionId, projectId, stored, request.user,
        );

        return reply.status(201).send({ attachment });
      } catch (err) { return handleError(err, reply); }
    },
  );
}
