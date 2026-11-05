/**
 * Daily Site Report V1 service.
 *
 * Every entry point: supervisor site scope (getAccessibleSiteIds, 404), then
 * the report is loaded with { id, companyId, projectId, siteId } (404). The
 * route chain has already run authenticate → requireRole → requireProjectAccess
 * (company, membership and site∈project).
 *
 * Data rules:
 *  - The report holds no money fields (strict zod content schema). Labour
 *    wages are financial under canViewFinancialData (report.service.ts) and a
 *    daily report is readable by roles without financial access.
 *  - AI extraction writes ONLY the ai* / extraction* columns, never `content`.
 *  - Audit rows carry ids, statuses, revisions and usage only — never rawInput,
 *    content, captions or model output.
 *  - This module never writes labour, attendance, inventory, delivery,
 *    schedule or finance tables.
 */
import { randomUUID } from 'crypto';
import { Prisma, DailyReport } from '@prisma/client';
import { prisma } from '../../utils/prisma';
import { env } from '../../utils/env';
import { RequestUser } from '../../types';
import { getAccessibleSiteIds } from '../../middleware/requireProjectAccess';
import { StorageDriver, SIGNED_URL_TTL_SECONDS } from '../storage/types';
import { InvalidImageError, normalisePhoto } from '../storage/image';
import { validateMagicBytes } from '../upload.service';
import { ExtractionError, ExtractionErrorCode, ReportExtractor } from './extractor/types';
import { RenderDailyReportPdf } from './pdf/types';
import {
  CONTENT_SCHEMA_VERSION, DailyReportContentV1, DailyReportDraftV1, SECTION_KEYS, emptyContent,
} from './content.schema';
import {
  DAILY_REPORT_EDIT_ROLES, DAILY_REPORT_REOPEN_ROLES, canSeeDraftInputs,
} from './policy';
import { canonicalJson, sha256Hex } from './canonical';
import {
  DailyReportError, photoNotFound, reportFinal, reportNotFinal, reportNotFound, staleReport, validationError,
} from './errors';

// ─── Dependencies (injected from the Fastify instance so tests use fakes) ─────

export interface DailyReportDeps {
  storage:   StorageDriver;
  extractor: ReportExtractor;
  renderPdf: RenderDailyReportPdf;
}

// ─── Limits ──────────────────────────────────────────────────────────────────

export const MAX_RAW_INPUT_CHARS     = 20_000;
export const MAX_PHOTOS_PER_REPORT   = 30;
export const MAX_PHOTO_BYTES         = 10 * 1024 * 1024;
export const MAX_CAPTION_CHARS       = 300;
export const DAILY_REPORT_PHOTO_TYPES = new Set(['image/jpeg', 'image/png']);
export const AI_EXTRACTION_AUDIT_ENTITY = 'daily_report_ai_extraction';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ─── Small helpers ───────────────────────────────────────────────────────────

export const displayNumber = (n: number): string => `DR-${String(n).padStart(4, '0')}`;

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** A real calendar date in YYYY-MM-DD form. */
export function isValidIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && isoDate(d) === value;
}

/** Today's date (YYYY-MM-DD) in the given IANA time zone; UTC if the zone is invalid. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
  } catch {
    return isoDate(now);
  }
}

function startOfUtcDay(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

const personSelect = { id: true, firstName: true, lastName: true } as const;
type Person = { id: string; firstName: string; lastName: string };
const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

function parseExpectedUpdatedAt(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw validationError('expectedUpdatedAt must be an ISO timestamp');
  return d;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

async function audit(
  actor: RequestUser,
  action: 'create' | 'update' | 'delete' | 'export',
  entityType: string,
  entityId: string,
  changesAfter: Record<string, unknown>,
  client: Prisma.TransactionClient = prisma,
): Promise<void> {
  await client.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action,
      entityType,
      entityId,
      changesAfter: changesAfter as Prisma.InputJsonValue,
    },
  });
}

// ─── Scope ───────────────────────────────────────────────────────────────────

/** Supervisors assigned to specific sites see only those sites; anything else is a 404. */
async function assertSiteAccess(projectId: string, siteId: string, actor: RequestUser): Promise<void> {
  const ids = await getAccessibleSiteIds(projectId, actor.id, actor.role);
  if (ids !== null && !ids.includes(siteId)) throw reportNotFound();
}

async function loadReport(
  actor: RequestUser, projectId: string, siteId: string, reportId: string,
): Promise<DailyReport> {
  await assertSiteAccess(projectId, siteId, actor);
  const report = await prisma.dailyReport.findFirst({
    where: { id: reportId, companyId: actor.companyId, projectId, siteId },
  });
  if (!report) throw reportNotFound();
  return report;
}

function assertDraft(report: DailyReport): void {
  if (report.status !== 'draft') throw reportFinal(report.id);
}

/**
 * Photo changes bump the report's updatedAt so a finalise that read the old
 * photo set fails as stale instead of committing a revision that no longer
 * matches the live report. Throws if the report stopped being a draft.
 */
async function touchDraft(tx: Prisma.TransactionClient, report: DailyReport): Promise<void> {
  const { count } = await tx.dailyReport.updateMany({
    where: { id: report.id, companyId: report.companyId, status: 'draft' },
    data:  { updatedAt: new Date() },
  });
  if (count === 0) throw reportFinal(report.id);
}

// ─── Response shapes ─────────────────────────────────────────────────────────

export interface DailyReportSummaryDto {
  id: string;
  reportDate: string;
  reportNumber: number;
  displayNumber: string;
  status: 'draft' | 'final';
  revision: number;
  photoCount: number;
  preparedBy: Person;
  finalisedAt: string | null;
  updatedAt: string;
}

export interface DailyReportPhotoDto {
  id: string;
  caption: string;
  sortOrder: number;
  width: number | null;
  height: number | null;
  url: string;
  urlExpiresAt: string;
}

const summarySelect = {
  id: true, reportDate: true, reportNumber: true, status: true, revision: true,
  finalisedAt: true, updatedAt: true,
  preparedBy: { select: personSelect },
  _count: { select: { photos: true } },
} satisfies Prisma.DailyReportSelect;

type SummaryRow = Prisma.DailyReportGetPayload<{ select: typeof summarySelect }>;

function toSummary(row: SummaryRow): DailyReportSummaryDto {
  return {
    id:            row.id,
    reportDate:    isoDate(row.reportDate),
    reportNumber:  row.reportNumber,
    displayNumber: displayNumber(row.reportNumber),
    status:        row.status,
    revision:      row.revision,
    photoCount:    row._count.photos,
    preparedBy:    row.preparedBy,
    finalisedAt:   row.finalisedAt ? row.finalisedAt.toISOString() : null,
    updatedAt:     row.updatedAt.toISOString(),
  };
}

async function toPhotoDto(
  storage: StorageDriver,
  photo: { id: string; caption: string; sortOrder: number; width: number | null; height: number | null; fileKey: string },
): Promise<DailyReportPhotoDto> {
  const urlExpiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  const url = await storage.signedUrl(photo.fileKey, { expiresInSec: SIGNED_URL_TTL_SECONDS });
  return {
    id: photo.id, caption: photo.caption, sortOrder: photo.sortOrder,
    width: photo.width, height: photo.height, url, urlExpiresAt,
  };
}

const photoOrder: Prisma.DailyReportPhotoOrderByWithRelationInput[] = [
  { sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' },
];

/** Full report as returned by every single-report endpoint. */
async function buildReportDto(deps: DailyReportDeps, actor: RequestUser, reportId: string) {
  const row = await prisma.dailyReport.findFirst({
    where: { id: reportId, companyId: actor.companyId },
    include: {
      project:     { select: { id: true, name: true } },
      site:        { select: { id: true, name: true } },
      preparedBy:  { select: personSelect },
      finalisedBy: { select: personSelect },
      photos:      { orderBy: photoOrder },
      revisions:   {
        orderBy: { revision: 'asc' },
        select: {
          revision: true, finalisedAt: true, reopenedAt: true, reopenReason: true,
          finalisedBy: { select: personSelect },
        },
      },
    },
  });
  if (!row) throw reportNotFound();

  const photos = await Promise.all(row.photos.map((p) => toPhotoDto(deps.storage, p)));
  const isDraft = row.status === 'draft';

  const report: Record<string, unknown> = {
    id:            row.id,
    reportDate:    isoDate(row.reportDate),
    reportNumber:  row.reportNumber,
    displayNumber: displayNumber(row.reportNumber),
    status:        row.status,
    revision:      row.revision,
    photoCount:    row.photos.length,
    preparedBy:    row.preparedBy,
    finalisedAt:   row.finalisedAt ? row.finalisedAt.toISOString() : null,
    updatedAt:     row.updatedAt.toISOString(),
    project:       row.project,
    site:          row.site,
    content:       row.content,
    contentSchemaVersion: row.contentSchemaVersion,
    photos,
    revisions: row.revisions.map((r) => ({
      revision:     r.revision,
      finalisedAt:  r.finalisedAt.toISOString(),
      finalisedBy:  r.finalisedBy,
      reopenedAt:   r.reopenedAt ? r.reopenedAt.toISOString() : null,
      reopenReason: r.reopenReason,
    })),
    finalisedBy: row.finalisedBy ?? null,
    canEdit:     isDraft && DAILY_REPORT_EDIT_ROLES.includes(actor.role),
    canReopen:   !isDraft && DAILY_REPORT_REOPEN_ROLES.includes(actor.role),
  };

  // Supervisor notes and AI output are for editors only.
  if (canSeeDraftInputs(actor.role)) {
    report['rawInput']         = row.rawInput;
    report['aiDraft']          = row.aiDraft ?? null;
    report['extractionStatus'] = row.extractionStatus;
    report['extractionError']  = row.extractionError;
    report['aiModel']          = row.aiModel;
  }
  return report;
}

// ─── 1. List ─────────────────────────────────────────────────────────────────

export interface ListQuery {
  date?:   string;
  status?: 'draft' | 'final';
  cursor?: string; // reportDate (YYYY-MM-DD) of the last row of the previous page
  limit:   number;
}

export async function listReports(actor: RequestUser, projectId: string, siteId: string, q: ListQuery) {
  await assertSiteAccess(projectId, siteId, actor);

  const dateFilter: Prisma.DateTimeFilter = {};
  if (q.date)   dateFilter.equals = new Date(`${q.date}T00:00:00.000Z`);
  if (q.cursor) dateFilter.lt     = new Date(`${q.cursor}T00:00:00.000Z`);

  const rows = await prisma.dailyReport.findMany({
    where: {
      companyId: actor.companyId, projectId, siteId,
      ...(q.status && { status: q.status }),
      ...((q.date || q.cursor) && { reportDate: dateFilter }),
    },
    orderBy: { reportDate: 'desc' },
    take: q.limit + 1,
    select: summarySelect,
  });

  const page = rows.slice(0, q.limit);
  const nextCursor = rows.length > q.limit ? isoDate(page[page.length - 1].reportDate) : null;
  return { reports: page.map(toSummary), nextCursor };
}

// ─── 2. Create or return ─────────────────────────────────────────────────────

export async function createOrGetReport(
  deps: DailyReportDeps, actor: RequestUser, projectId: string, siteId: string, reportDate: string,
): Promise<{ created: boolean; report: Record<string, unknown> }> {
  await assertSiteAccess(projectId, siteId, actor);
  if (!isValidIsoDate(reportDate)) throw validationError('reportDate must be a valid YYYY-MM-DD date');

  const company = await prisma.company.findUnique({
    where: { id: actor.companyId }, select: { timezone: true },
  });
  const today = todayInTimeZone(company?.timezone ?? 'UTC');
  if (reportDate > today) {
    throw new DailyReportError(422, 'FUTURE_DATE', 'A daily report cannot be created for a future date');
  }
  const date = new Date(`${reportDate}T00:00:00.000Z`);

  const existingOrNull = async () => {
    const existing = await prisma.dailyReport.findFirst({
      where: { companyId: actor.companyId, projectId, siteId, reportDate: date },
      select: { id: true, status: true },
    });
    if (!existing) return null;
    if (existing.status === 'final') throw reportFinal(existing.id);
    return { created: false, report: await buildReportDto(deps, actor, existing.id) };
  };

  const found = await existingOrNull();
  if (found) return found;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const agg = await tx.dailyReport.aggregate({ where: { siteId }, _max: { reportNumber: true } });
        const report = await tx.dailyReport.create({
          data: {
            companyId:    actor.companyId,
            projectId,
            siteId,
            reportDate:   date,
            reportNumber: (agg._max.reportNumber ?? 0) + 1,
            content:      emptyContent() as Prisma.InputJsonValue,
            contentSchemaVersion: CONTENT_SCHEMA_VERSION,
            preparedById: actor.id,
          },
          select: { id: true, reportNumber: true },
        });
        await audit(actor, 'create', 'daily_report', report.id,
          { status: 'draft', revision: 0, reportNumber: report.reportNumber, reportDate }, tx);
        return report;
      });
      return { created: true, report: await buildReportDto(deps, actor, created.id) };
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // Either the same date was created concurrently (return it) or the number
      // was taken (retry once with a fresh max).
      const raced = await existingOrNull();
      if (raced) return raced;
      if (attempt === 1) throw err;
    }
  }
  /* istanbul ignore next */
  throw new Error('unreachable');
}

// ─── 3. Get ──────────────────────────────────────────────────────────────────

export async function getReport(
  deps: DailyReportDeps, actor: RequestUser, projectId: string, siteId: string, reportId: string,
) {
  const report = await loadReport(actor, projectId, siteId, reportId);
  return buildReportDto(deps, actor, report.id);
}

// ─── 4. Update draft ─────────────────────────────────────────────────────────

export interface UpdateInput {
  rawInput?: string;
  content?: unknown;
  expectedUpdatedAt: string;
}

export async function updateReport(
  deps: DailyReportDeps, actor: RequestUser, projectId: string, siteId: string, reportId: string,
  input: UpdateInput,
) {
  const expected = parseExpectedUpdatedAt(input.expectedUpdatedAt);
  const report = await loadReport(actor, projectId, siteId, reportId);
  assertDraft(report);

  if (input.rawInput === undefined && input.content === undefined) {
    throw validationError('Nothing to update: send rawInput and/or content');
  }
  if (input.rawInput !== undefined && input.rawInput.length > MAX_RAW_INPUT_CHARS) {
    throw validationError(`rawInput must be at most ${MAX_RAW_INPUT_CHARS} characters`);
  }

  const data: Prisma.DailyReportUpdateManyMutationInput = {};
  if (input.rawInput !== undefined) data.rawInput = input.rawInput;
  if (input.content !== undefined) {
    const parsed = DailyReportContentV1.safeParse(input.content);
    if (!parsed.success) {
      throw validationError('Invalid report content', { details: parsed.error.flatten() });
    }
    data.content = parsed.data as Prisma.InputJsonValue;
  }

  const { count } = await prisma.dailyReport.updateMany({
    where: { id: report.id, companyId: actor.companyId, status: 'draft', updatedAt: expected },
    data,
  });
  if (count === 0) throw staleReport();

  await audit(actor, 'update', 'daily_report', report.id, {
    fields: Object.keys(data), status: 'draft', revision: report.revision,
  });
  return buildReportDto(deps, actor, report.id);
}

// ─── 5. AI extraction ────────────────────────────────────────────────────────

const EXTRACTION_HTTP: Record<ExtractionErrorCode, { status: number; message: string }> = {
  AI_DISABLED:    { status: 503, message: 'AI extraction is not available' },
  AI_UNAVAILABLE: { status: 503, message: 'AI extraction is temporarily unavailable' },
  AI_BUSY:        { status: 503, message: 'AI extraction is busy; try again shortly' },
  AI_NO_DRAFT:    { status: 422, message: 'AI could not produce a draft from these notes' },
  AI_ERROR:       { status: 502, message: 'AI extraction failed' },
};

export async function extractDraft(
  deps: DailyReportDeps, actor: RequestUser, projectId: string, siteId: string, reportId: string,
) {
  const report = await loadReport(actor, projectId, siteId, reportId);
  assertDraft(report);
  if (report.rawInput.trim() === '') throw validationError('Save some site notes before running extraction');

  const used = await prisma.auditLog.count({
    where: {
      companyId: actor.companyId,
      entityType: AI_EXTRACTION_AUDIT_ENTITY,
      createdAt: { gte: startOfUtcDay() },
    },
  });
  if (used >= env.DAILY_REPORT_AI_DAILY_CAP_PER_COMPANY) {
    throw new DailyReportError(429, 'AI_CAP_REACHED', 'Daily AI extraction limit reached for your company');
  }

  const [project, site, company] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true } }),
    prisma.jobSite.findUniqueOrThrow({ where: { id: siteId }, select: { name: true } }),
    prisma.company.findUniqueOrThrow({ where: { id: actor.companyId }, select: { timezone: true } }),
  ]);

  let code: ExtractionErrorCode | null = null;
  let result: Awaited<ReturnType<ReportExtractor['extract']>> | null = null;
  try {
    result = await deps.extractor.extract({
      rawInput: report.rawInput,
      context: {
        projectName: project.name,
        siteName:    site.name,
        reportDate:  isoDate(report.reportDate),
        timezone:    company.timezone,
      },
    });
    // Defence in depth: never store a draft that does not match the schema.
    const parsed = DailyReportDraftV1.safeParse(result.draft);
    if (!parsed.success) code = 'AI_ERROR';
    else result = { ...result, draft: parsed.data };
  } catch (err) {
    code = err instanceof ExtractionError ? err.code : 'AI_ERROR';
  }

  if (code !== null || result === null) {
    const failCode: ExtractionErrorCode = code ?? 'AI_ERROR';
    // rawInput and content are left untouched.
    await prisma.dailyReport.updateMany({
      where: { id: report.id, status: 'draft' },
      data:  { extractionStatus: 'failed', extractionError: failCode },
    });
    await audit(actor, 'create', AI_EXTRACTION_AUDIT_ENTITY, report.id, {
      status: 'failed', errorCode: failCode,
    });
    const http = EXTRACTION_HTTP[failCode];
    throw new DailyReportError(http.status, failCode, http.message);
  }

  // ONLY ai* / extraction* columns — content is never touched by the AI.
  const { count } = await prisma.dailyReport.updateMany({
    where: { id: report.id, status: 'draft' },
    data: {
      aiDraft: { draft: result.draft, unsupportedNumbers: result.unsupportedNumbers } as unknown as Prisma.InputJsonValue,
      aiModel:          result.model,
      aiPromptVersion:  result.promptVersion,
      aiUsage:          { ...result.usage } as Prisma.InputJsonValue,
      extractionStatus: 'succeeded',
      extractionError:  null,
    },
  });
  await audit(actor, 'create', AI_EXTRACTION_AUDIT_ENTITY, report.id, {
    status:  count === 0 ? 'discarded' : 'succeeded',
    model:   result.model,
    promptVersion: result.promptVersion,
    usage:   { ...result.usage },
    unsupportedNumberCount: result.unsupportedNumbers.length,
  });
  if (count === 0) throw reportFinal(report.id); // finalised while the model was running

  return buildReportDto(deps, actor, report.id);
}

// ─── 6–8. Photos ─────────────────────────────────────────────────────────────

/** Runs before the multipart body is read: scope, draft state, count limit. */
export async function assertCanAddPhoto(
  actor: RequestUser, projectId: string, siteId: string, reportId: string,
): Promise<DailyReport> {
  const report = await loadReport(actor, projectId, siteId, reportId);
  assertDraft(report);
  const count = await prisma.dailyReportPhoto.count({ where: { dailyReportId: report.id } });
  if (count >= MAX_PHOTOS_PER_REPORT) {
    throw new DailyReportError(422, 'FILE_LIMIT_REACHED', `Maximum ${MAX_PHOTOS_PER_REPORT} photos per report`);
  }
  return report;
}

export interface IncomingPhoto {
  buffer:   Buffer;
  filename: string;
  mimetype: string;
}

export async function addPhoto(
  deps: DailyReportDeps, actor: RequestUser, report: DailyReport, file: IncomingPhoto,
): Promise<DailyReportPhotoDto> {
  if (!DAILY_REPORT_PHOTO_TYPES.has(file.mimetype) || !validateMagicBytes(file.buffer, file.mimetype)) {
    throw new DailyReportError(422, 'INVALID_FILE_TYPE', 'Only JPEG and PNG photos are allowed');
  }
  if (file.buffer.length > MAX_PHOTO_BYTES) {
    throw new DailyReportError(413, 'FILE_TOO_LARGE', 'Photo too large (max 10 MB)');
  }

  let normalised: Awaited<ReturnType<typeof normalisePhoto>>;
  try {
    normalised = await normalisePhoto(file.buffer);
  } catch (err) {
    if (err instanceof InvalidImageError) {
      throw new DailyReportError(422, 'INVALID_FILE_TYPE', 'The photo could not be read as an image');
    }
    throw err;
  }

  const fileKey = `daily-reports/${report.companyId}/${report.id}/photos/${randomUUID()}.jpg`;
  await deps.storage.put(fileKey, normalised.data, { contentType: normalised.contentType });

  try {
    const photo = await prisma.$transaction(async (tx) => {
      // Re-check under the write: still a draft, still under the limit.
      const current = await tx.dailyReport.findFirst({
        where: { id: report.id, companyId: report.companyId }, select: { status: true },
      });
      if (!current) throw reportNotFound();
      if (current.status !== 'draft') throw reportFinal(report.id);
      const agg = await tx.dailyReportPhoto.aggregate({
        where: { dailyReportId: report.id }, _max: { sortOrder: true }, _count: { _all: true },
      });
      if (agg._count._all >= MAX_PHOTOS_PER_REPORT) {
        throw new DailyReportError(422, 'FILE_LIMIT_REACHED', `Maximum ${MAX_PHOTOS_PER_REPORT} photos per report`);
      }
      const created = await tx.dailyReportPhoto.create({
        data: {
          companyId:     report.companyId,
          dailyReportId: report.id,
          fileKey,
          fileName:      (file.filename || 'photo').slice(0, 255),
          fileType:      normalised.contentType,
          fileSizeBytes: normalised.data.length,
          sha256:        normalised.sha256,
          width:         normalised.width || null,
          height:        normalised.height || null,
          sortOrder:     (agg._max.sortOrder ?? -1) + 1,
          uploadedById:  actor.id,
        },
      });
      await touchDraft(tx, report);
      await audit(actor, 'create', 'daily_report_photo', created.id,
        { dailyReportId: report.id, fileSizeBytes: created.fileSizeBytes }, tx);
      return created;
    });
    return toPhotoDto(deps.storage, photo);
  } catch (err) {
    await deps.storage.delete(fileKey).catch(() => undefined);
    throw err;
  }
}

export async function updatePhoto(
  deps: DailyReportDeps, actor: RequestUser, projectId: string, siteId: string, reportId: string,
  photoId: string, input: { caption?: string; sortOrder?: number },
): Promise<DailyReportPhotoDto> {
  const report = await loadReport(actor, projectId, siteId, reportId);
  assertDraft(report);
  const photo = await prisma.dailyReportPhoto.findFirst({
    where: { id: photoId, dailyReportId: report.id, companyId: actor.companyId },
  });
  if (!photo) throw photoNotFound();
  if (input.caption === undefined && input.sortOrder === undefined) {
    throw validationError('Nothing to update: send caption and/or sortOrder');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.dailyReportPhoto.update({
      where: { id: photo.id },
      data: {
        ...(input.caption !== undefined && { caption: input.caption }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
      },
    });
    await touchDraft(tx, report);
    await audit(actor, 'update', 'daily_report_photo', photo.id, {
      dailyReportId: report.id,
      fields: Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined),
    }, tx);
    return row;
  });
  return toPhotoDto(deps.storage, updated);
}

export async function deletePhoto(
  deps: DailyReportDeps, actor: RequestUser, projectId: string, siteId: string, reportId: string,
  photoId: string,
): Promise<void> {
  const report = await loadReport(actor, projectId, siteId, reportId);
  assertDraft(report);
  const photo = await prisma.dailyReportPhoto.findFirst({
    where: { id: photoId, dailyReportId: report.id, companyId: actor.companyId },
  });
  if (!photo) throw photoNotFound();

  await prisma.$transaction(async (tx) => {
    await tx.dailyReportPhoto.delete({ where: { id: photo.id } });
    await touchDraft(tx, report);
    await audit(actor, 'delete', 'daily_report_photo', photo.id, { dailyReportId: report.id }, tx);
  });
  // Row first, then the object: a failed delete leaves an unreferenced object,
  // never a row pointing at nothing. Earlier revision PDFs embed their own copy.
  await deps.storage.delete(photo.fileKey).catch(() => undefined);
}

// ─── 9. Finalise ─────────────────────────────────────────────────────────────

export function computeContentHash(payload: {
  companyId: string; projectId: string; siteId: string; reportDate: string; reportNumber: number;
  revision: number; contentSchemaVersion: number; content: DailyReportContentV1;
  photos: Array<{ sha256: string; caption: string; sortOrder: number }>;
}): string {
  return sha256Hex(canonicalJson(payload));
}

// Each finalise attempt writes its own object, so a stale or retried attempt
// can never overwrite or delete the PDF of a revision another attempt
// committed. The committed key is recorded on the header and revision rows.
export const pdfKeyFor = (companyId: string, reportId: string, revision: number, attemptId: string) =>
  `daily-reports/${companyId}/${reportId}/rev-${revision}-${attemptId}.pdf`;

export async function finaliseReport(
  deps: DailyReportDeps, actor: RequestUser, projectId: string, siteId: string, reportId: string,
  input: { expectedUpdatedAt: string },
) {
  const expected = parseExpectedUpdatedAt(input.expectedUpdatedAt);
  const report = await loadReport(actor, projectId, siteId, reportId);
  assertDraft(report);
  if (report.updatedAt.getTime() !== expected.getTime()) throw staleReport();

  const parsed = DailyReportContentV1.safeParse(report.content);
  if (!parsed.success) {
    throw validationError('Report content is invalid', { details: parsed.error.flatten() });
  }
  const content = parsed.data;
  const missing = SECTION_KEYS.filter((k) => !content.reviewedSections.includes(k));
  if (missing.length > 0) {
    throw new DailyReportError(422, 'REVIEW_INCOMPLETE', 'Every section must be reviewed before finalising', { missing });
  }

  const [company, project, site, preparedBy, finaliser, photos] = await Promise.all([
    prisma.company.findUniqueOrThrow({
      where: { id: actor.companyId }, select: { name: true, timezone: true, logoKey: true },
    }),
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true, code: true } }),
    prisma.jobSite.findUniqueOrThrow({ where: { id: siteId }, select: { name: true, address: true } }),
    prisma.user.findUniqueOrThrow({ where: { id: report.preparedById }, select: personSelect }),
    prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: personSelect }),
    prisma.dailyReportPhoto.findMany({ where: { dailyReportId: report.id }, orderBy: photoOrder }),
  ]);

  const photoBytes = await Promise.all(photos.map(async (p) => {
    const data = await deps.storage.get(p.fileKey);
    if (!data) {
      throw new DailyReportError(422, 'PHOTO_MISSING', 'A photo file is missing; remove it and upload it again');
    }
    return { data, caption: p.caption };
  }));
  const logo = company.logoKey ? await deps.storage.get(company.logoKey) : null;

  const reportDate = isoDate(report.reportDate);
  const finalisedAt = new Date();
  const contentHash = computeContentHash({
    companyId: report.companyId, projectId, siteId, reportDate,
    reportNumber: report.reportNumber, revision: report.revision,
    contentSchemaVersion: report.contentSchemaVersion, content,
    photos: photos.map((p) => ({ sha256: p.sha256, caption: p.caption, sortOrder: p.sortOrder })),
  });

  // Render OUTSIDE the DB transaction.
  const pdf = await deps.renderPdf({
    company: { name: company.name, logo },
    project: { name: project.name, code: project.code },
    site:    { name: site.name, address: site.address },
    report:  { number: displayNumber(report.reportNumber), revision: report.revision, reportDate, timezone: company.timezone },
    content,
    photos:  photoBytes,
    preparedBy:  fullName(preparedBy),
    finalisedBy: fullName(finaliser),
    finalisedAt,
    contentHash,
  });

  const pdfFileKey = pdfKeyFor(report.companyId, report.id, report.revision, randomUUID());
  await deps.storage.put(pdfFileKey, pdf, { contentType: 'application/pdf' });

  try {
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.dailyReport.updateMany({
        where: { id: report.id, companyId: actor.companyId, status: 'draft', updatedAt: expected },
        data: {
          status: 'final', finalisedById: actor.id, finalisedAt, pdfFileKey, contentHash,
          content: content as Prisma.InputJsonValue,
        },
      });
      if (count === 0) throw staleReport();
      await tx.dailyReportRevision.create({
        data: {
          companyId:            report.companyId,
          dailyReportId:        report.id,
          revision:             report.revision,
          content:              content as Prisma.InputJsonValue,
          contentSchemaVersion: report.contentSchemaVersion,
          photos: photos.map((p) => ({
            photoId: p.id, fileKey: p.fileKey, sha256: p.sha256, caption: p.caption, sortOrder: p.sortOrder,
          })) as Prisma.InputJsonValue,
          pdfFileKey,
          contentHash,
          finalisedById: actor.id,
          finalisedAt,
        },
      });
      await audit(actor, 'update', 'daily_report', report.id,
        { status: 'final', revision: report.revision, contentHash, photoCount: photos.length }, tx);
    });
  } catch (err) {
    // This attempt's key is unique to it, so its orphan PDF is always safe to remove.
    await deps.storage.delete(pdfFileKey).catch(() => undefined);
    throw err;
  }

  return buildReportDto(deps, actor, report.id);
}

// ─── 10. Reopen ──────────────────────────────────────────────────────────────

export async function reopenReport(
  deps: DailyReportDeps, actor: RequestUser, projectId: string, siteId: string, reportId: string,
  input: { reason: string; expectedUpdatedAt: string },
) {
  const expected = parseExpectedUpdatedAt(input.expectedUpdatedAt);
  const report = await loadReport(actor, projectId, siteId, reportId);
  if (report.status !== 'final') throw reportNotFinal();

  const reopenedAt = new Date();
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.dailyReport.updateMany({
      where: { id: report.id, companyId: actor.companyId, status: 'final', updatedAt: expected },
      data: {
        status: 'draft', revision: { increment: 1 },
        finalisedById: null, finalisedAt: null, pdfFileKey: null, contentHash: null,
      },
    });
    if (count === 0) throw staleReport();
    await tx.dailyReportRevision.update({
      where: { dailyReportId_revision: { dailyReportId: report.id, revision: report.revision } },
      data: { reopenedById: actor.id, reopenedAt, reopenReason: input.reason },
    });
    await audit(actor, 'update', 'daily_report', report.id,
      { status: 'draft', reopenedRevision: report.revision, revision: report.revision + 1 }, tx);
  });

  return buildReportDto(deps, actor, report.id);
}

// ─── 11. PDF download ────────────────────────────────────────────────────────

export async function getReportPdf(
  deps: DailyReportDeps, actor: RequestUser, projectId: string, siteId: string, reportId: string,
  revision: number | undefined,
): Promise<{ data: Buffer; filename: string }> {
  const report = await loadReport(actor, projectId, siteId, reportId);
  const rev = await prisma.dailyReportRevision.findFirst({
    where: {
      dailyReportId: report.id, companyId: actor.companyId,
      ...(revision !== undefined && { revision }),
    },
    orderBy: { revision: 'desc' },
    select: { revision: true, pdfFileKey: true },
  });
  if (!rev) throw new DailyReportError(404, 'NOT_FOUND', 'PDF not found');

  const data = await deps.storage.get(rev.pdfFileKey);
  if (!data) throw new DailyReportError(404, 'NOT_FOUND', 'PDF not found');

  await audit(actor, 'export', 'daily_report_pdf', report.id, { revision: rev.revision });
  return { data, filename: `${displayNumber(report.reportNumber)}-rev${rev.revision}.pdf` };
}
