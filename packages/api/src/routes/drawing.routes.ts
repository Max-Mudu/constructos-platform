import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireProjectAccess } from '../middleware/requireProjectAccess';
import * as drawingService from '../services/drawing.service';
import { handleError } from '../utils/errors';
import {
  storeFile,
  validateMagicBytes,
  ALLOWED_DOCUMENT_TYPES,
  MAX_FILE_SIZE_BYTES,
} from '../services/upload.service';

// ─── Schemas ──────────────────────────────────────────────────────────────────

const DRAWING_STATUSES = [
  'draft', 'issued_for_review', 'issued_for_construction', 'superseded', 'archived',
] as const;

const createDrawingSchema = z.object({
  drawingNumber: z.string().min(1).max(100),
  title:         z.string().min(1).max(500),
  discipline:    z.string().max(100).optional(),
  siteId:        z.string().uuid().optional(),
});

const updateDrawingSchema = z.object({
  title:      z.string().min(1).max(500).optional(),
  discipline: z.string().max(100).nullish(),
  siteId:     z.string().uuid().nullish(),
});

const approveRevisionSchema = z.object({
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const commentSchema = z.object({
  text: z.string().min(1).max(5000),
});

// ─── Role groups ──────────────────────────────────────────────────────────────

const VIEW_ROLES   = ['company_admin', 'project_manager', 'site_supervisor',
                      'consultant', 'contractor', 'finance_officer', 'viewer'] as const;
const MANAGE_ROLES = ['company_admin', 'project_manager'] as const;
const COMMENT_ROLES = ['company_admin', 'project_manager', 'site_supervisor',
                       'consultant', 'contractor', 'finance_officer'] as const;

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function drawingRoutes(fastify: FastifyInstance): Promise<void> {

  // GET /projects/:projectId/drawings
  fastify.get(
    '/',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId } = request.params as { projectId: string };
        const q = request.query as Record<string, string>;
        const drawings = await drawingService.listDrawings(projectId, request.user, {
          discipline: q['discipline'],
          status:     q['status'] as drawingService.UploadRevisionInput['status'],
          siteId:     q['siteId'],
          search:     q['search'],
        });
        return reply.send({ drawings });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /projects/:projectId/drawings
  fastify.post(
    '/',
    { preHandler: [authenticate, requireRole(...MANAGE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = createDrawingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed', code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId } = request.params as { projectId: string };
        const drawing = await drawingService.createDrawing(projectId, parsed.data, request.user);
        return reply.status(201).send({ drawing });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // GET /projects/:projectId/drawings/:drawingId
  fastify.get(
    '/:drawingId',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, drawingId } = request.params as { projectId: string; drawingId: string };
        const drawing = await drawingService.getDrawing(drawingId, projectId, request.user);
        return reply.send({ drawing });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // PATCH /projects/:projectId/drawings/:drawingId
  fastify.patch(
    '/:drawingId',
    { preHandler: [authenticate, requireRole(...MANAGE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = updateDrawingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed', code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId, drawingId } = request.params as { projectId: string; drawingId: string };
        const drawing = await drawingService.updateDrawing(drawingId, projectId, parsed.data, request.user);
        return reply.send({ drawing });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // DELETE /projects/:projectId/drawings/:drawingId
  fastify.delete(
    '/:drawingId',
    { preHandler: [authenticate, requireRole(...MANAGE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, drawingId } = request.params as { projectId: string; drawingId: string };
        await drawingService.deleteDrawing(drawingId, projectId, request.user);
        return reply.status(204).send();
      } catch (err) { return handleError(err, reply); }
    },
  );

  // ── Revisions ──────────────────────────────────────────────────────────────

  // POST /projects/:projectId/drawings/:drawingId/revisions  (multipart file upload)
  fastify.post(
    '/:drawingId/revisions',
    { preHandler: [authenticate, requireRole(...MANAGE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, drawingId } = request.params as { projectId: string; drawingId: string };

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
          return reply.status(422).send({ error: 'File content does not match declared type', code: 'INVALID_FILE_CONTENT' });
        }

        const fields = data.fields as Record<string, { value: string }>;
        const revisionNumber = fields['revisionNumber']?.value;
        const status         = (fields['status']?.value || 'draft') as drawingService.UploadRevisionInput['status'];
        const issueDate      = fields['issueDate']?.value;
        const notes          = fields['notes']?.value;

        if (!revisionNumber) {
          return reply.status(422).send({ error: 'revisionNumber is required', code: 'VALIDATION_ERROR' });
        }

        if (!DRAWING_STATUSES.includes(status as typeof DRAWING_STATUSES[number])) {
          return reply.status(422).send({ error: 'Invalid status', code: 'VALIDATION_ERROR' });
        }

        const stored = await storeFile(buffer, data.filename, data.mimetype, 'drawings');

        const revision = await drawingService.uploadRevision(drawingId, projectId, {
          revisionNumber,
          status,
          issueDate,
          notes,
          ...stored,
        }, request.user);

        return reply.status(201).send({ revision });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /projects/:projectId/drawings/:drawingId/revisions/:revisionId/approve
  fastify.post(
    '/:drawingId/revisions/:revisionId/approve',
    { preHandler: [authenticate, requireRole(...MANAGE_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = approveRevisionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed', code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId, drawingId, revisionId } = request.params as {
          projectId: string; drawingId: string; revisionId: string;
        };
        const revision = await drawingService.approveRevision(
          revisionId, drawingId, projectId, parsed.data, request.user,
        );
        return reply.send({ revision });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // ── Comments ───────────────────────────────────────────────────────────────

  // GET /projects/:projectId/drawings/:drawingId/revisions/:revisionId/comments
  fastify.get(
    '/:drawingId/revisions/:revisionId/comments',
    { preHandler: [authenticate, requireRole(...VIEW_ROLES), requireProjectAccess] },
    async (request, reply) => {
      try {
        const { projectId, drawingId, revisionId } = request.params as {
          projectId: string; drawingId: string; revisionId: string;
        };
        const comments = await drawingService.listComments(revisionId, drawingId, projectId, request.user);
        return reply.send({ comments });
      } catch (err) { return handleError(err, reply); }
    },
  );

  // POST /projects/:projectId/drawings/:drawingId/revisions/:revisionId/comments
  fastify.post(
    '/:drawingId/revisions/:revisionId/comments',
    { preHandler: [authenticate, requireRole(...COMMENT_ROLES), requireProjectAccess] },
    async (request, reply) => {
      const parsed = commentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(422).send({
          error: 'Validation failed', code: 'VALIDATION_ERROR',
          details: parsed.error.flatten().fieldErrors,
        });
      }
      try {
        const { projectId, drawingId, revisionId } = request.params as {
          projectId: string; drawingId: string; revisionId: string;
        };
        const comment = await drawingService.addComment(
          revisionId, drawingId, projectId, parsed.data, request.user,
        );
        return reply.status(201).send({ comment });
      } catch (err) { return handleError(err, reply); }
    },
  );
}
