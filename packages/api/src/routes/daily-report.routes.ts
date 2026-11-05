/**
 * Daily Site Report V1 routes.
 * Prefix: /api/v1/projects/:projectId/sites/:siteId/daily-reports
 *
 * Chain on every route: authenticate → requireRole(...) → requireProjectAccess
 * (company + membership + site∈project). Supervisor site scope and the
 * report lookup by { id, companyId, projectId, siteId } happen in the service.
 * HTTP contract: daily-report-api-contract.md.
 */
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { MultipartFile } from '@fastify/multipart';
import { authenticate } from '../middleware/authenticate';
import { requireRole } from '../middleware/requireRole';
import { requireProjectAccess } from '../middleware/requireProjectAccess';
import {
  DAILY_REPORT_EDIT_ROLES, DAILY_REPORT_REOPEN_ROLES, DAILY_REPORT_VIEW_ROLES,
} from '../services/daily-report/policy';
import * as service from '../services/daily-report/daily-report.service';
import { DailyReportError, sendDailyReportError, validationError } from '../services/daily-report/errors';
import { StorageDriver } from '../services/storage/types';
import { ReportExtractor } from '../services/daily-report/extractor/types';
import { RenderDailyReportPdf } from '../services/daily-report/pdf/types';

declare module 'fastify' {
  interface FastifyInstance {
    storage:         StorageDriver;
    reportExtractor: ReportExtractor;
    renderPdf:       RenderDailyReportPdf;
  }
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const isoDate = z.string().refine(service.isValidIsoDate, 'Must be a valid YYYY-MM-DD date');
const expectedUpdatedAt = z.string().datetime({ offset: true });

const listQuerySchema = z.object({
  date:   isoDate.optional(),
  status: z.enum(['draft', 'final']).optional(),
  cursor: isoDate.optional(),
  limit:  z.coerce.number().int().min(1).max(50).default(20),
});

const createSchema = z.object({ reportDate: z.string() }).strict();

const updateSchema = z.object({
  rawInput: z.string().max(service.MAX_RAW_INPUT_CHARS).optional(),
  content:  z.unknown().optional(),
  expectedUpdatedAt,
}).strict();

const photoUpdateSchema = z.object({
  caption:   z.string().trim().max(service.MAX_CAPTION_CHARS).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
}).strict();

const finaliseSchema = z.object({ expectedUpdatedAt }).strict();

const reopenSchema = z.object({
  reason: z.string().trim().min(5).max(500),
  expectedUpdatedAt,
}).strict();

const pdfQuerySchema = z.object({
  revision: z.coerce.number().int().min(0).optional(),
});

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw validationError('Validation failed', { details: parsed.error.flatten().fieldErrors });
  }
  return parsed.data;
}

type Params = { projectId: string; siteId: string; reportId: string; photoId: string };
const params = (request: FastifyRequest) => request.params as Params;

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function dailyReportRoutes(fastify: FastifyInstance): Promise<void> {
  const deps = (): service.DailyReportDeps => ({
    storage:   fastify.storage,
    extractor: fastify.reportExtractor,
    renderPdf: fastify.renderPdf,
  });

  const VIEW   = { preHandler: [authenticate, requireRole(...DAILY_REPORT_VIEW_ROLES), requireProjectAccess] };
  const EDIT   = { preHandler: [authenticate, requireRole(...DAILY_REPORT_EDIT_ROLES), requireProjectAccess] };
  const REOPEN = { preHandler: [authenticate, requireRole(...DAILY_REPORT_REOPEN_ROLES), requireProjectAccess] };

  // 1. GET / — per-site history, newest reportDate first
  fastify.get('/', VIEW, async (request, reply) => {
    try {
      const { projectId, siteId } = params(request);
      const q = parse(listQuerySchema, request.query);
      return reply.send(await service.listReports(request.user, projectId, siteId, q));
    } catch (err) { return sendDailyReportError(err, reply); }
  });

  // 2. POST / — create-or-return the report for (site, date)
  fastify.post('/', EDIT, async (request, reply) => {
    try {
      const { projectId, siteId } = params(request);
      const body = parse(createSchema, request.body);
      const { created, report } = await service.createOrGetReport(
        deps(), request.user, projectId, siteId, body.reportDate,
      );
      return reply.status(created ? 201 : 200).send({ report });
    } catch (err) { return sendDailyReportError(err, reply); }
  });

  // 3. GET /:reportId
  fastify.get('/:reportId', VIEW, async (request, reply) => {
    try {
      const { projectId, siteId, reportId } = params(request);
      return reply.send({ report: await service.getReport(deps(), request.user, projectId, siteId, reportId) });
    } catch (err) { return sendDailyReportError(err, reply); }
  });

  // 4. PATCH /:reportId — save notes and/or reviewed content (draft only)
  fastify.patch('/:reportId', EDIT, async (request, reply) => {
    try {
      const { projectId, siteId, reportId } = params(request);
      const body = parse(updateSchema, request.body);
      const report = await service.updateReport(deps(), request.user, projectId, siteId, reportId, body);
      return reply.send({ report });
    } catch (err) { return sendDailyReportError(err, reply); }
  });

  // 5. POST /:reportId/extract — AI draft from saved rawInput; writes only ai* fields
  fastify.post(
    '/:reportId/extract',
    { ...EDIT, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request, reply) => {
      try {
        const { projectId, siteId, reportId } = params(request);
        const report = await service.extractDraft(deps(), request.user, projectId, siteId, reportId);
        return reply.send({ report });
      } catch (err) { return sendDailyReportError(err, reply); }
    },
  );

  // 6. POST /:reportId/photos — multipart, field "file", JPEG/PNG ≤ 10 MB
  fastify.post('/:reportId/photos', EDIT, async (request, reply) => {
    try {
      const { projectId, siteId, reportId } = params(request);
      // Scope, draft state and count limit are checked before reading the body.
      const report = await service.assertCanAddPhoto(request.user, projectId, siteId, reportId);

      let file: MultipartFile | undefined;
      try {
        file = await request.file({ limits: { fileSize: service.MAX_PHOTO_BYTES, files: 1 } });
      } catch {
        throw new DailyReportError(400, 'INVALID_UPLOAD', 'Expected a multipart upload with one file');
      }
      if (!file || file.fieldname !== 'file') {
        throw new DailyReportError(400, 'NO_FILE', 'No file provided (field "file")');
      }

      let buffer: Buffer;
      try {
        buffer = await file.toBuffer();
      } catch {
        throw new DailyReportError(413, 'FILE_TOO_LARGE', 'Photo too large (max 10 MB)');
      }

      const photo = await service.addPhoto(deps(), request.user, report, {
        buffer, filename: file.filename, mimetype: file.mimetype,
      });
      return reply.status(201).send({ photo });
    } catch (err) { return sendDailyReportError(err, reply); }
  });

  // 7. PATCH /:reportId/photos/:photoId — caption / sortOrder (draft only)
  fastify.patch('/:reportId/photos/:photoId', EDIT, async (request, reply) => {
    try {
      const { projectId, siteId, reportId, photoId } = params(request);
      const body = parse(photoUpdateSchema, request.body);
      const photo = await service.updatePhoto(deps(), request.user, projectId, siteId, reportId, photoId, body);
      return reply.send({ photo });
    } catch (err) { return sendDailyReportError(err, reply); }
  });

  // 8. DELETE /:reportId/photos/:photoId (draft only)
  fastify.delete('/:reportId/photos/:photoId', EDIT, async (request, reply) => {
    try {
      const { projectId, siteId, reportId, photoId } = params(request);
      await service.deletePhoto(deps(), request.user, projectId, siteId, reportId, photoId);
      return reply.status(204).send();
    } catch (err) { return sendDailyReportError(err, reply); }
  });

  // 9. POST /:reportId/finalise — every section reviewed → PDF + revision row
  fastify.post('/:reportId/finalise', EDIT, async (request, reply) => {
    try {
      const { projectId, siteId, reportId } = params(request);
      const body = parse(finaliseSchema, request.body);
      const report = await service.finaliseReport(deps(), request.user, projectId, siteId, reportId, body);
      return reply.send({ report });
    } catch (err) { return sendDailyReportError(err, reply); }
  });

  // 10. POST /:reportId/reopen — final → draft, revision + 1
  fastify.post('/:reportId/reopen', REOPEN, async (request, reply) => {
    try {
      const { projectId, siteId, reportId } = params(request);
      const body = parse(reopenSchema, request.body);
      const report = await service.reopenReport(deps(), request.user, projectId, siteId, reportId, body);
      return reply.send({ report });
    } catch (err) { return sendDailyReportError(err, reply); }
  });

  // 11. GET /:reportId/pdf?revision=n — latest final revision by default
  fastify.get('/:reportId/pdf', VIEW, async (request, reply) => {
    try {
      const { projectId, siteId, reportId } = params(request);
      const q = parse(pdfQuerySchema, request.query);
      const { data, filename } = await service.getReportPdf(
        deps(), request.user, projectId, siteId, reportId, q.revision,
      );
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Cache-Control', 'private, no-store')
        .send(data);
    } catch (err) { return sendDailyReportError(err, reply); }
  });
}
