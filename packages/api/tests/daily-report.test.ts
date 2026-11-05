/**
 * Daily Site Report V1 — lifecycle contract tests:
 * create-or-return, numbering, dates, PATCH + optimistic concurrency, list,
 * finalise, reopen, re-finalise, PDF download, data-hygiene invariants.
 * All external dependencies are injected fakes (no network, no disk).
 */
import { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { MemoryStorageDriver } from '../src/services/storage/memory';
import { DailyReportPdfInput, RenderDailyReportPdf } from '../src/services/daily-report/pdf/types';
import { ExtractionError, ReportExtractor } from '../src/services/daily-report/extractor/types';
import { SECTION_KEYS, emptyContent } from '../src/services/daily-report/content.schema';
import {
  computeContentHash, todayInTimeZone,
} from '../src/services/daily-report/daily-report.service';
import {
  assignUserToProject, buildMultipartFile, clearDatabase, createTestCompany, createTestDailyReport,
  createTestProject, createTestSite, createTestUser, TEST_JPEG_BYTES, TestUser,
} from './helpers/fixtures';

// ─── Fakes ────────────────────────────────────────────────────────────────────

const storage = new MemoryStorageDriver();
const renderCalls: DailyReportPdfInput[] = [];
let renderMode: 'ok' | 'throw' | 'bump-report' = 'ok';

const renderPdf: RenderDailyReportPdf = async (input) => {
  renderCalls.push(input);
  if (renderMode === 'throw') throw new Error('renderer exploded');
  if (renderMode === 'bump-report') {
    // Simulates a concurrent edit landing between render and commit.
    await prisma.dailyReport.updateMany({ where: { status: 'draft' }, data: { rawInput: 'concurrent edit' } });
  }
  return Buffer.from(`%PDF-1.4 fake ${input.report.number} rev${input.report.revision} ${input.contentHash}`);
};

const extractor: ReportExtractor = {
  async extract() { throw new ExtractionError('AI_DISABLED'); },
};

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ storage, renderPdf, reportExtractor: extractor });
  await app.ready();
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
  storage.objects.clear();
  renderCalls.length = 0;
  renderMode = 'ok';
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const base = (projectId: string, siteId: string) =>
  `/api/v1/projects/${projectId}/sites/${siteId}/daily-reports`;

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.accessToken}` });

const RAW_MARKER = 'RAWNOTE-zebra-7731 poured 12 m3 slab on level 2';
const CONTENT_MARKER = 'CONTENTMARK-ocelot-5512';
const CAPTION_MARKER = 'CAPTIONMARK-heron-0042';

function reviewedContent(description = CONTENT_MARKER) {
  return {
    ...emptyContent(),
    workCompleted: [{ description, location: 'Level 2', quantity: 12, unit: 'm3', progressPercent: 40 }],
    reviewedSections: [...SECTION_KEYS],
  };
}

async function setup(slug = 'dr') {
  const { company, admin } = await createTestCompany(app, slug);
  const project = await createTestProject(company.id, 'Riverside Block A');
  const site = await createTestSite(company.id, project.id, 'North Yard');
  const site2 = await createTestSite(company.id, project.id, 'South Yard');
  const pm = await createTestUser(app, company.id, 'project_manager', `${slug}-pm`);
  await assignUserToProject(company.id, project.id, pm.id);
  const sup = await createTestUser(app, company.id, 'site_supervisor', `${slug}-sup`);
  await assignUserToProject(company.id, project.id, sup.id, site.id);
  const viewer = await createTestUser(app, company.id, 'viewer', `${slug}-viewer`);
  await assignUserToProject(company.id, project.id, viewer.id);
  return { company, admin, project, site, site2, pm, sup, viewer, url: base(project.id, site.id) };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

const responses: unknown[] = [];
function json(res: LightMyRequestResponse) {
  const body = res.json();
  responses.push(body);
  return body;
}

async function create(ctx: Ctx, user: TestUser, reportDate = '2026-04-07', url = ctx.url) {
  const res = await app.inject({ method: 'POST', url, headers: auth(user), payload: { reportDate } });
  return { res, body: json(res) };
}

async function patch(ctx: Ctx, user: TestUser, id: string, payload: Record<string, unknown>) {
  const res = await app.inject({ method: 'PATCH', url: `${ctx.url}/${id}`, headers: auth(user), payload });
  return { res, body: json(res) };
}

async function finalise(ctx: Ctx, user: TestUser, id: string, expectedUpdatedAt: string) {
  const res = await app.inject({
    method: 'POST', url: `${ctx.url}/${id}/finalise`, headers: auth(user), payload: { expectedUpdatedAt },
  });
  return { res, body: json(res) };
}

/** Creates a report and saves fully-reviewed content; returns the latest report. */
async function readyDraft(ctx: Ctx, user: TestUser = ctx.sup, reportDate = '2026-04-07') {
  const { body } = await create(ctx, user, reportDate);
  const saved = await patch(ctx, user, body.report.id, {
    rawInput: RAW_MARKER, content: reviewedContent(), expectedUpdatedAt: body.report.updatedAt,
  });
  expect(saved.res.statusCode).toBe(200);
  return saved.body.report;
}

async function otherTableCounts() {
  const [labour, attendance, invTx, siteInv, delivery, invoice, budgetLine, schedule, target] = await Promise.all([
    prisma.labourEntry.count(), prisma.attendanceRecord.count(), prisma.inventoryTransaction.count(),
    prisma.siteInventory.count(), prisma.deliveryRecord.count(), prisma.invoice.count(),
    prisma.budgetLineItem.count(), prisma.scheduleTask.count(), prisma.dailyTarget.count(),
  ]);
  return { labour, attendance, invTx, siteInv, delivery, invoice, budgetLine, schedule, target };
}

const MONEY_KEY = /(rate|wage|cost|amount|currency|price|salary|payment|budget|invoice)/i;
function moneyKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => moneyKeys(v, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(MONEY_KEY.test(k) ? [`${path}.${k}`] : []),
      ...moneyKeys(v, `${path}.${k}`),
    ]);
  }
  return [];
}

// ─── Create-or-return, numbering, dates ───────────────────────────────────────

describe('POST / — create-or-return', () => {
  it('creates a draft (201) with empty content and DR-0001, then returns it (200) for the same date', async () => {
    const ctx = await setup();
    const first = await create(ctx, ctx.sup);
    expect(first.res.statusCode).toBe(201);
    const r = first.body.report;
    expect(r).toMatchObject({
      reportDate: '2026-04-07', reportNumber: 1, displayNumber: 'DR-0001', status: 'draft', revision: 0,
      photoCount: 0, photos: [], revisions: [], rawInput: '', aiDraft: null, extractionStatus: 'not_requested',
      extractionError: null, aiModel: null, finalisedAt: null, finalisedBy: null, canEdit: true, canReopen: false,
      contentSchemaVersion: 1,
      project: { id: ctx.project.id, name: 'Riverside Block A' },
      site: { id: ctx.site.id, name: 'North Yard' },
      preparedBy: { id: ctx.sup.id },
    });
    expect(r.content).toEqual(emptyContent());

    const again = await create(ctx, ctx.pm);
    expect(again.res.statusCode).toBe(200);
    expect(again.body.report.id).toBe(r.id);
    expect(await prisma.dailyReport.count()).toBe(1);

    const audit = await prisma.auditLog.findFirst({ where: { entityType: 'daily_report', action: 'create' } });
    expect(audit?.entityId).toBe(r.id);
  });

  it('numbers reports per site, in creation order', async () => {
    const ctx = await setup();
    expect((await create(ctx, ctx.admin, '2026-04-07')).body.report.reportNumber).toBe(1);
    expect((await create(ctx, ctx.admin, '2026-04-05')).body.report.reportNumber).toBe(2);
    expect((await create(ctx, ctx.admin, '2026-04-09')).body.report.displayNumber).toBe('DR-0003');
    const other = await create(ctx, ctx.admin, '2026-04-07', base(ctx.project.id, ctx.site2.id));
    expect(other.res.statusCode).toBe(201);
    expect(other.body.report.reportNumber).toBe(1);
  });

  it('two concurrent creates for different dates get distinct numbers', async () => {
    const ctx = await setup();
    const [a, b] = await Promise.all([create(ctx, ctx.admin, '2026-04-01'), create(ctx, ctx.pm, '2026-04-02')]);
    expect([a.res.statusCode, b.res.statusCode]).toEqual([201, 201]);
    expect([a.body.report.reportNumber, b.body.report.reportNumber].sort()).toEqual([1, 2]);
  });

  it('two concurrent creates for the same date yield one report (201 + 200)', async () => {
    const ctx = await setup();
    const [a, b] = await Promise.all([create(ctx, ctx.admin, '2026-04-03'), create(ctx, ctx.sup, '2026-04-03')]);
    expect([a.res.statusCode, b.res.statusCode].sort()).toEqual([200, 201]);
    expect(a.body.report.id).toBe(b.body.report.id);
    expect(await prisma.dailyReport.count()).toBe(1);
  });

  it('rejects a future date (in the company time zone) with 422 FUTURE_DATE', async () => {
    const ctx = await setup();
    const future = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const { res, body } = await create(ctx, ctx.sup, future);
    expect(res.statusCode).toBe(422);
    expect(body.code).toBe('FUTURE_DATE');

    const today = todayInTimeZone('UTC');
    expect((await create(ctx, ctx.sup, today)).res.statusCode).toBe(201);
  });

  it('uses Company.timezone for "today"', async () => {
    const now = new Date('2026-11-05T12:00:00.000Z');
    expect(todayInTimeZone('Pacific/Kiritimati', now)).toBe('2026-11-06');
    expect(todayInTimeZone('America/Los_Angeles', new Date('2026-11-05T05:00:00.000Z'))).toBe('2026-11-04');
    expect(todayInTimeZone('Not/AZone', now)).toBe('2026-11-05');

    // A company far ahead of UTC can file "tomorrow (UTC)" when it is already today locally.
    const ctx = await setup();
    await prisma.company.update({ where: { id: ctx.company.id }, data: { timezone: 'Pacific/Kiritimati' } });
    const local = todayInTimeZone('Pacific/Kiritimati');
    expect((await create(ctx, ctx.sup, local)).res.statusCode).toBe(201);
  });

  it('rejects malformed and impossible dates with 422 VALIDATION_ERROR', async () => {
    const ctx = await setup();
    for (const d of ['2026-02-30', '07/04/2026', '']) {
      const { res, body } = await create(ctx, ctx.sup, d);
      expect(res.statusCode).toBe(422);
      expect(body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns 409 REPORT_FINAL with the reportId when the date already has a final report', async () => {
    const ctx = await setup();
    const existing = await createTestDailyReport(ctx.company.id, ctx.project.id, ctx.site.id, ctx.sup.id, {
      reportDate: '2026-04-07', status: 'final',
    });
    const { res, body } = await create(ctx, ctx.sup, '2026-04-07');
    expect(res.statusCode).toBe(409);
    expect(body).toMatchObject({ code: 'REPORT_FINAL', reportId: existing.id });
  });
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

describe('PATCH /:reportId', () => {
  it('saves rawInput and normalised content, and advances updatedAt', async () => {
    const ctx = await setup();
    const { body } = await create(ctx, ctx.sup);
    const content = { ...reviewedContent('  Poured slab  '), reviewedSections: ['weather'] };
    const { res, body: saved } = await patch(ctx, ctx.sup, body.report.id, {
      rawInput: RAW_MARKER, content, expectedUpdatedAt: body.report.updatedAt,
    });
    expect(res.statusCode).toBe(200);
    expect(saved.report.rawInput).toBe(RAW_MARKER);
    expect(saved.report.content.workCompleted[0].description).toBe('Poured slab');
    expect(saved.report.content.reviewedSections).toEqual(['weather']);
    expect(saved.report.updatedAt).not.toBe(body.report.updatedAt);
  });

  it('returns 409 STALE_REPORT when expectedUpdatedAt is old', async () => {
    const ctx = await setup();
    const { body } = await create(ctx, ctx.sup);
    const stale = body.report.updatedAt;
    expect((await patch(ctx, ctx.sup, body.report.id, { rawInput: 'one', expectedUpdatedAt: stale })).res.statusCode).toBe(200);
    const second = await patch(ctx, ctx.pm, body.report.id, { rawInput: 'two', expectedUpdatedAt: stale });
    expect(second.res.statusCode).toBe(409);
    expect(second.body.code).toBe('STALE_REPORT');
    const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: body.report.id } });
    expect(row.rawInput).toBe('one');
  });

  it('rejects invalid content, money keys, oversize notes and missing expectedUpdatedAt (422)', async () => {
    const ctx = await setup();
    const { body } = await create(ctx, ctx.sup);
    const id = body.report.id;
    const exp = body.report.updatedAt;
    const cases: Record<string, unknown>[] = [
      { content: { ...emptyContent(), manpower: { entries: [{ trade: 'Mason', count: 4, dailyRate: 50 }] } }, expectedUpdatedAt: exp },
      { content: { ...emptyContent(), cost: 100 }, expectedUpdatedAt: exp },
      { content: { ...emptyContent(), reviewedSections: ['budget'] }, expectedUpdatedAt: exp },
      { rawInput: 'x'.repeat(20_001), expectedUpdatedAt: exp },
      { rawInput: 'no timestamp' },
      { expectedUpdatedAt: exp },
      { rawInput: 'ok', expectedUpdatedAt: exp, status: 'final' },
    ];
    for (const payload of cases) {
      const { res, body: err } = await patch(ctx, ctx.sup, id, payload);
      expect(res.statusCode).toBe(422);
      expect(err.code).toBe('VALIDATION_ERROR');
    }
    // 20 000 characters is allowed.
    expect((await patch(ctx, ctx.sup, id, { rawInput: 'y'.repeat(20_000), expectedUpdatedAt: exp })).res.statusCode).toBe(200);
  });

  it('returns 409 REPORT_FINAL on a final report', async () => {
    const ctx = await setup();
    const r = await createTestDailyReport(ctx.company.id, ctx.project.id, ctx.site.id, ctx.sup.id, { status: 'final' });
    const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: r.id } });
    const { res, body } = await patch(ctx, ctx.admin, r.id, { rawInput: 'x', expectedUpdatedAt: row.updatedAt.toISOString() });
    expect(res.statusCode).toBe(409);
    expect(body.code).toBe('REPORT_FINAL');
  });

  it('returns 404 for an unknown report id and for a report on another site', async () => {
    const ctx = await setup();
    const other = await createTestDailyReport(ctx.company.id, ctx.project.id, ctx.site2.id, ctx.admin.id);
    for (const id of ['00000000-0000-0000-0000-000000000000', other.id]) {
      const { res, body } = await patch(ctx, ctx.admin, id, { rawInput: 'x', expectedUpdatedAt: new Date().toISOString() });
      expect(res.statusCode).toBe(404);
      expect(body.code).toBe('NOT_FOUND');
    }
  });
});

// ─── List ─────────────────────────────────────────────────────────────────────

describe('GET / — list', () => {
  it('lists newest reportDate first with cursor pagination and filters; rows carry no notes', async () => {
    const ctx = await setup();
    for (const d of ['2026-04-01', '2026-04-03', '2026-04-02']) await create(ctx, ctx.admin, d);
    await prisma.dailyReport.updateMany({ where: { reportDate: new Date('2026-04-02T00:00:00Z') }, data: { status: 'final' } });

    const p1 = await app.inject({ method: 'GET', url: `${ctx.url}?limit=2`, headers: auth(ctx.viewer) });
    expect(p1.statusCode).toBe(200);
    const b1 = json(p1);
    expect(b1.reports.map((r: { reportDate: string }) => r.reportDate)).toEqual(['2026-04-03', '2026-04-02']);
    expect(b1.nextCursor).toBe('2026-04-02');
    expect(Object.keys(b1.reports[0]).sort()).toEqual([
      'displayNumber', 'finalisedAt', 'id', 'photoCount', 'preparedBy', 'reportDate', 'reportNumber',
      'revision', 'status', 'updatedAt',
    ]);
    expect(Object.keys(b1.reports[0].preparedBy).sort()).toEqual(['firstName', 'id', 'lastName']);

    const p2 = json(await app.inject({ method: 'GET', url: `${ctx.url}?limit=2&cursor=${b1.nextCursor}`, headers: auth(ctx.viewer) }));
    expect(p2.reports.map((r: { reportDate: string }) => r.reportDate)).toEqual(['2026-04-01']);
    expect(p2.nextCursor).toBeNull();

    const finals = json(await app.inject({ method: 'GET', url: `${ctx.url}?status=final`, headers: auth(ctx.sup) }));
    expect(finals.reports).toHaveLength(1);
    expect(finals.reports[0].status).toBe('final');

    const byDate = json(await app.inject({ method: 'GET', url: `${ctx.url}?date=2026-04-01`, headers: auth(ctx.pm) }));
    expect(byDate.reports.map((r: { reportDate: string }) => r.reportDate)).toEqual(['2026-04-01']);

    const bad = await app.inject({ method: 'GET', url: `${ctx.url}?limit=51`, headers: auth(ctx.pm) });
    expect(bad.statusCode).toBe(422);
  });
});

// ─── Finalise / reopen / PDF ──────────────────────────────────────────────────

describe('finalise → reopen → re-finalise → PDF', () => {
  it('rejects finalise with 422 REVIEW_INCOMPLETE listing the unreviewed sections', async () => {
    const ctx = await setup();
    const { body } = await create(ctx, ctx.sup);
    const saved = await patch(ctx, ctx.sup, body.report.id, {
      content: { ...emptyContent(), reviewedSections: ['weather', 'manpower', 'remarks'] },
      expectedUpdatedAt: body.report.updatedAt,
    });
    const { res, body: err } = await finalise(ctx, ctx.sup, body.report.id, saved.body.report.updatedAt);
    expect(res.statusCode).toBe(422);
    expect(err.code).toBe('REVIEW_INCOMPLETE');
    expect(err.missing).toEqual(
      ['workCompleted', 'delays', 'safety', 'materialsDeliveries', 'visitorsInstructions', 'tomorrowPlan'],
    );
    expect(renderCalls).toHaveLength(0);
  });

  it('finalises: status final, revision row, PDF stored under rev-0, content hash, logo + photos rendered', async () => {
    const ctx = await setup();
    const logoKey = `companies/${ctx.company.id}/logo/logo.png`;
    const logo = Buffer.from('fake-logo-bytes');
    await storage.put(logoKey, logo, { contentType: 'image/png' });
    await prisma.company.update({ where: { id: ctx.company.id }, data: { logoKey } });

    const draft = await readyDraft(ctx);
    const mp = buildMultipartFile('site.jpg', 'image/jpeg', TEST_JPEG_BYTES);
    const up = await app.inject({ method: 'POST', url: `${ctx.url}/${draft.id}/photos`, headers: { ...auth(ctx.sup), ...mp.headers }, payload: mp.body });
    expect(up.statusCode).toBe(201);
    const photoId = json(up).photo.id;
    await app.inject({ method: 'PATCH', url: `${ctx.url}/${draft.id}/photos/${photoId}`, headers: auth(ctx.sup), payload: { caption: CAPTION_MARKER } });

    // Photo changes bump updatedAt, so finalising with the pre-photo version is stale.
    const stale = await finalise(ctx, ctx.sup, draft.id, draft.updatedAt);
    expect(stale.res.statusCode).toBe(409);
    expect(stale.body.code).toBe('STALE_REPORT');
    const current = await app.inject({ method: 'GET', url: `${ctx.url}/${draft.id}`, headers: auth(ctx.sup) });

    const before = await otherTableCounts();
    const { res, body } = await finalise(ctx, ctx.sup, draft.id, json(current).report.updatedAt);
    expect(res.statusCode).toBe(200);
    const r = body.report;
    expect(r).toMatchObject({ status: 'final', revision: 0, canEdit: false, canReopen: false, finalisedBy: { id: ctx.sup.id } });
    expect(r.finalisedAt).toEqual(expect.any(String));
    expect(r.revisions).toHaveLength(1);
    expect(r.revisions[0]).toMatchObject({ revision: 0, finalisedBy: { id: ctx.sup.id }, reopenedAt: null, reopenReason: null });

    const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: draft.id } });
    const photo = await prisma.dailyReportPhoto.findUniqueOrThrow({ where: { id: photoId } });
    const expectedHash = computeContentHash({
      companyId: ctx.company.id, projectId: ctx.project.id, siteId: ctx.site.id, reportDate: '2026-04-07',
      reportNumber: 1, revision: 0, contentSchemaVersion: 1, content: reviewedContent(),
      photos: [{ sha256: photo.sha256, caption: CAPTION_MARKER, sortOrder: 0 }],
    });
    expect(row.contentHash).toBe(expectedHash);
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.pdfFileKey).toMatch(new RegExp(`^daily-reports/${ctx.company.id}/${draft.id}/rev-0-[0-9a-f-]{36}\\.pdf$`));
    expect(storage.objects.get(row.pdfFileKey!)?.contentType).toBe('application/pdf');

    const rev = await prisma.dailyReportRevision.findUniqueOrThrow({
      where: { dailyReportId_revision: { dailyReportId: draft.id, revision: 0 } },
    });
    expect(rev).toMatchObject({ pdfFileKey: row.pdfFileKey, contentHash: expectedHash, finalisedById: ctx.sup.id, contentSchemaVersion: 1 });
    expect(rev.content).toEqual(reviewedContent());
    expect(rev.photos).toEqual([{ photoId, fileKey: photo.fileKey, sha256: photo.sha256, caption: CAPTION_MARKER, sortOrder: 0 }]);

    expect(renderCalls).toHaveLength(1);
    const input = renderCalls[0];
    expect(input.company).toEqual({ name: ctx.company.name, logo });
    expect(input.report).toMatchObject({ number: 'DR-0001', revision: 0, reportDate: '2026-04-07', timezone: 'UTC' });
    // The renderer gets the stored (normalised) bytes, not the upload.
    expect(input.photos).toEqual([{ data: storage.objects.get(photo.fileKey)!.body, caption: CAPTION_MARKER }]);
    expect(input.contentHash).toBe(expectedHash);
    expect(input.preparedBy).toBe(`site_supervisor dr-sup`);
    expect(input.finalisedBy).toBe(`site_supervisor dr-sup`);
    expect(moneyKeys(input.content)).toEqual([]);

    // Hashing is canonical: key order does not matter, content does.
    const reordered = Object.fromEntries(Object.entries(reviewedContent()).reverse()) as ReturnType<typeof reviewedContent>;
    expect(computeContentHash({
      companyId: ctx.company.id, projectId: ctx.project.id, siteId: ctx.site.id, reportDate: '2026-04-07',
      reportNumber: 1, revision: 0, contentSchemaVersion: 1, content: reordered,
      photos: [{ sha256: photo.sha256, caption: CAPTION_MARKER, sortOrder: 0 }],
    })).toBe(expectedHash);

    expect(await otherTableCounts()).toEqual(before);

    // Final-state conflicts.
    const again = await finalise(ctx, ctx.sup, draft.id, r.updatedAt);
    expect(again.res.statusCode).toBe(409);
    expect(again.body.code).toBe('REPORT_FINAL');
    const p = await patch(ctx, ctx.sup, draft.id, { rawInput: 'late', expectedUpdatedAt: r.updatedAt });
    expect(p.body.code).toBe('REPORT_FINAL');
    const mp2 = buildMultipartFile('late.jpg', 'image/jpeg', TEST_JPEG_BYTES);
    const lateUpload = await app.inject({ method: 'POST', url: `${ctx.url}/${draft.id}/photos`, headers: { ...auth(ctx.sup), ...mp2.headers }, payload: mp2.body });
    expect(lateUpload.statusCode).toBe(409);
    expect(json(lateUpload).code).toBe('REPORT_FINAL');
    const ex = await app.inject({ method: 'POST', url: `${ctx.url}/${draft.id}/extract`, headers: auth(ctx.sup), payload: {} });
    expect(ex.statusCode).toBe(409);
  });

  it('returns 409 STALE_REPORT for an old expectedUpdatedAt and renders nothing', async () => {
    const ctx = await setup();
    const { body } = await create(ctx, ctx.sup);
    const draft = await readyDraft(ctx);
    const { res, body: err } = await finalise(ctx, ctx.sup, draft.id, body.report.updatedAt);
    expect(res.statusCode).toBe(409);
    expect(err.code).toBe('STALE_REPORT');
    expect(renderCalls).toHaveLength(0);
  });

  it('a renderer failure leaves the report draft with no PDF stored', async () => {
    const ctx = await setup();
    const draft = await readyDraft(ctx);
    renderMode = 'throw';
    const res = await app.inject({
      method: 'POST', url: `${ctx.url}/${draft.id}/finalise`, headers: auth(ctx.sup), payload: { expectedUpdatedAt: draft.updatedAt },
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('renderer exploded');
    expect(res.json()).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.status).toBe('draft');
    expect(await prisma.dailyReportRevision.count()).toBe(0);
    expect([...storage.objects.keys()].filter((k) => k.endsWith('.pdf'))).toEqual([]);
  });

  it('a concurrent edit during rendering → 409 STALE_REPORT and the orphan PDF is deleted', async () => {
    const ctx = await setup();
    const draft = await readyDraft(ctx);
    renderMode = 'bump-report';
    const { res, body } = await finalise(ctx, ctx.sup, draft.id, draft.updatedAt);
    expect(res.statusCode).toBe(409);
    expect(body.code).toBe('STALE_REPORT');
    expect(renderCalls).toHaveLength(1);
    expect([...storage.objects.keys()].filter((k) => k.endsWith('.pdf'))).toEqual([]);
    expect(await prisma.dailyReportRevision.count()).toBe(0);
    expect((await prisma.dailyReport.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('draft');
  });

  it('reopen → edit → re-finalise produces revision 1; PDFs download per revision', async () => {
    const ctx = await setup();
    const before = await otherTableCounts();
    const draft = await readyDraft(ctx);
    const final0 = (await finalise(ctx, ctx.sup, draft.id, draft.updatedAt)).body.report;
    const hash0 = (await prisma.dailyReport.findUniqueOrThrow({ where: { id: draft.id } })).contentHash;
    expect(hash0).toMatch(/^[0-9a-f]{64}$/);

    // Supervisors cannot reopen; reason length and state are validated.
    const supReopen = await app.inject({ method: 'POST', url: `${ctx.url}/${draft.id}/reopen`, headers: auth(ctx.sup), payload: { reason: 'Wrong quantity', expectedUpdatedAt: final0.updatedAt } });
    expect(supReopen.statusCode).toBe(403);
    for (const reason of ['abc', 'x'.repeat(501), '    ']) {
      const bad = await app.inject({ method: 'POST', url: `${ctx.url}/${draft.id}/reopen`, headers: auth(ctx.pm), payload: { reason, expectedUpdatedAt: final0.updatedAt } });
      expect(bad.statusCode).toBe(422);
    }
    const staleReopen = await app.inject({ method: 'POST', url: `${ctx.url}/${draft.id}/reopen`, headers: auth(ctx.pm), payload: { reason: 'Wrong quantity', expectedUpdatedAt: draft.updatedAt } });
    expect(staleReopen.statusCode).toBe(409);
    expect(json(staleReopen).code).toBe('STALE_REPORT');

    const reopenRes = await app.inject({ method: 'POST', url: `${ctx.url}/${draft.id}/reopen`, headers: auth(ctx.pm), payload: { reason: 'Wrong slab quantity', expectedUpdatedAt: final0.updatedAt } });
    expect(reopenRes.statusCode).toBe(200);
    const reopened = json(reopenRes).report;
    expect(reopened).toMatchObject({ status: 'draft', revision: 1, finalisedAt: null, finalisedBy: null, canEdit: true });
    expect(reopened.revisions[0]).toMatchObject({ revision: 0, reopenReason: 'Wrong slab quantity', reopenedAt: expect.any(String) });
    const header = await prisma.dailyReport.findUniqueOrThrow({ where: { id: draft.id } });
    expect(header.pdfFileKey).toBeNull();
    expect(header.contentHash).toBeNull();
    const rev0 = await prisma.dailyReportRevision.findUniqueOrThrow({ where: { dailyReportId_revision: { dailyReportId: draft.id, revision: 0 } } });
    expect(rev0.reopenedById).toBe(ctx.pm.id);

    const reopenDraft = await app.inject({ method: 'POST', url: `${ctx.url}/${draft.id}/reopen`, headers: auth(ctx.pm), payload: { reason: 'Again please', expectedUpdatedAt: reopened.updatedAt } });
    expect(reopenDraft.statusCode).toBe(409);
    expect(json(reopenDraft).code).toBe('REPORT_NOT_FINAL');

    // Previous PDF is still downloadable while the report is a draft again.
    const midPdf = await app.inject({ method: 'GET', url: `${ctx.url}/${draft.id}/pdf`, headers: auth(ctx.viewer) });
    expect(midPdf.statusCode).toBe(200);
    expect(midPdf.rawPayload.toString()).toContain('rev0');

    const edited = await patch(ctx, ctx.sup, draft.id, { content: reviewedContent('Corrected slab volume'), expectedUpdatedAt: reopened.updatedAt });
    const final1 = await finalise(ctx, ctx.sup, draft.id, edited.body.report.updatedAt);
    expect(final1.res.statusCode).toBe(200);
    expect(final1.body.report).toMatchObject({ status: 'final', revision: 1 });
    expect(final1.body.report.revisions.map((r: { revision: number }) => r.revision)).toEqual([0, 1]);
    const header1 = await prisma.dailyReport.findUniqueOrThrow({ where: { id: draft.id } });
    expect(header1.pdfFileKey).toMatch(new RegExp(`^daily-reports/${ctx.company.id}/${draft.id}/rev-1-[0-9a-f-]{36}\\.pdf$`));
    expect(header1.contentHash).not.toBe(hash0);
    const rev0Row = await prisma.dailyReportRevision.findUniqueOrThrow({
      where: { dailyReportId_revision: { dailyReportId: draft.id, revision: 0 } },
    });
    expect(storage.objects.has(rev0Row.pdfFileKey)).toBe(true);

    // Default: latest final revision.
    const latest = await app.inject({ method: 'GET', url: `${ctx.url}/${draft.id}/pdf`, headers: auth(ctx.viewer) });
    expect(latest.statusCode).toBe(200);
    expect(latest.headers['content-type']).toBe('application/pdf');
    expect(latest.headers['content-disposition']).toBe('attachment; filename="DR-0001-rev1.pdf"');
    expect(latest.headers['cache-control']).toBe('private, no-store');
    expect(latest.rawPayload.toString()).toBe(`%PDF-1.4 fake DR-0001 rev1 ${header1.contentHash}`);

    const old = await app.inject({ method: 'GET', url: `${ctx.url}/${draft.id}/pdf?revision=0`, headers: auth(ctx.admin) });
    expect(old.statusCode).toBe(200);
    expect(old.headers['content-disposition']).toBe('attachment; filename="DR-0001-rev0.pdf"');
    expect(old.rawPayload.toString()).toContain('DR-0001 rev0');

    const missing = await app.inject({ method: 'GET', url: `${ctx.url}/${draft.id}/pdf?revision=7`, headers: auth(ctx.admin) });
    expect(missing.statusCode).toBe(404);
    const badRev = await app.inject({ method: 'GET', url: `${ctx.url}/${draft.id}/pdf?revision=abc`, headers: auth(ctx.admin) });
    expect(badRev.statusCode).toBe(422);

    const exports = await prisma.auditLog.findMany({ where: { action: 'export', entityType: 'daily_report_pdf', entityId: draft.id } });
    expect(exports).toHaveLength(3);

    expect(await otherTableCounts()).toEqual(before);
  });

  it('PDF of a never-finalised report is 404', async () => {
    const ctx = await setup();
    const { body } = await create(ctx, ctx.sup);
    const res = await app.inject({ method: 'GET', url: `${ctx.url}/${body.report.id}/pdf`, headers: auth(ctx.sup) });
    expect(res.statusCode).toBe(404);
    expect(json(res).code).toBe('NOT_FOUND');
  });
});

// ─── Data hygiene ─────────────────────────────────────────────────────────────

describe('data hygiene', () => {
  it('audit rows never contain notes, content or caption text', async () => {
    const ctx = await setup();
    const draft = await readyDraft(ctx);
    const mp = buildMultipartFile('a.jpg', 'image/jpeg', TEST_JPEG_BYTES);
    const up = json(await app.inject({ method: 'POST', url: `${ctx.url}/${draft.id}/photos`, headers: { ...auth(ctx.sup), ...mp.headers }, payload: mp.body }));
    await app.inject({ method: 'PATCH', url: `${ctx.url}/${draft.id}/photos/${up.photo.id}`, headers: auth(ctx.sup), payload: { caption: CAPTION_MARKER } });
    const latest = json(await app.inject({ method: 'GET', url: `${ctx.url}/${draft.id}`, headers: auth(ctx.sup) })).report;
    const fin = (await finalise(ctx, ctx.sup, draft.id, latest.updatedAt)).body.report;
    await app.inject({ method: 'POST', url: `${ctx.url}/${draft.id}/reopen`, headers: auth(ctx.pm), payload: { reason: 'Correction needed', expectedUpdatedAt: fin.updatedAt } });

    const audits = await prisma.auditLog.findMany({ where: { companyId: ctx.company.id } });
    expect(audits.length).toBeGreaterThanOrEqual(6);
    const dump = JSON.stringify(audits);
    for (const marker of ['RAWNOTE-zebra-7731', CONTENT_MARKER, CAPTION_MARKER, 'Correction needed']) {
      expect(dump).not.toContain(marker);
    }
  });

  it('no response in this suite carries a money key', () => {
    expect(responses.length).toBeGreaterThan(20);
    expect(responses.flatMap((r) => moneyKeys(r))).toEqual([]);
  });
});
