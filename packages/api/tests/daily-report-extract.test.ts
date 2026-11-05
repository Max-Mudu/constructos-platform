/**
 * Daily Site Report V1 — AI extraction: writes only ai* fields, never content
 * or any operational table; failure keeps the supervisor's work; daily cap.
 * The extractor is an injected fake: no network.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { env } from '../src/utils/env';
import { MemoryStorageDriver } from '../src/services/storage/memory';
import { RenderDailyReportPdf } from '../src/services/daily-report/pdf/types';
import {
  ExtractionError, ExtractionErrorCode, ExtractionResult, ReportExtractor,
} from '../src/services/daily-report/extractor/types';
import { DailyReportContentV1, DailyReportDraftV1, emptyContent } from '../src/services/daily-report/content.schema';
import {
  assignUserToProject, clearDatabase, createTestAttendanceRecord, createTestBudget, createTestCompany,
  createTestDelivery, createTestInvoice, createTestLabourEntry, createTestLineItem, createTestProject,
  createTestSite, createTestUser, createTestWorker, TestUser,
} from './helpers/fixtures';

// ─── Fake extractor ───────────────────────────────────────────────────────────

const RAW = 'RAWNOTE-kestrel-3390: 4 masons, poured 12 m3 slab on level 2, rain stopped work at 3pm';
const DRAFT_MARKER = 'DRAFTMARK-lynx-8812';

const DRAFT = DailyReportDraftV1.parse({
  weather: { conditions: ['light_rain'], workStoppedByWeather: true, notes: 'Rain from 3pm' },
  manpower: { entries: [{ trade: 'Mason', count: 4, employer: 'Own staff' }], totalOnSite: 4 },
  workCompleted: [{ description: 'Poured slab', location: 'Level 2', quantity: 12, unit: 'm3' }],
  remarks: DRAFT_MARKER,
});

const USAGE = {
  inputTokens: 1200, outputTokens: 340, cacheReadInputTokens: 1000, cacheCreationInputTokens: 0,
  latencyMs: 2100, stopReason: 'end_turn', requestId: 'req_fake_1',
};

type Mode = 'ok' | 'invalid-draft' | 'plain-error' | ExtractionErrorCode;
let mode: Mode = 'ok';
const calls: Array<Parameters<ReportExtractor['extract']>[0]> = [];

const extractor: ReportExtractor = {
  async extract(input) {
    calls.push(input);
    if (mode === 'ok') {
      const result: ExtractionResult = {
        draft: DRAFT, unsupportedNumbers: [{ path: 'manpower.totalOnSite', value: 99 }],
        model: 'fake-model-1', promptVersion: 'dsr-v1-test', usage: USAGE,
      };
      return result;
    }
    if (mode === 'invalid-draft') {
      return {
        draft: { ...DRAFT, cost: 100 } as unknown as ExtractionResult['draft'], unsupportedNumbers: [],
        model: 'fake-model-1', promptVersion: 'dsr-v1-test', usage: USAGE,
      };
    }
    if (mode === 'plain-error') throw new Error(`upstream said: ${input.rawInput}`);
    throw new ExtractionError(mode);
  },
};

const storage = new MemoryStorageDriver();
const renderPdf: RenderDailyReportPdf = async () => Buffer.from('%PDF-1.4 x');

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
  mode = 'ok';
  calls.length = 0;
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.accessToken}` });

async function setup(slug = 'drx') {
  const { company, admin } = await createTestCompany(app, slug);
  await prisma.company.update({ where: { id: company.id }, data: { timezone: 'Africa/Nairobi' } });
  const project = await createTestProject(company.id, 'Lakeside Clinic');
  const site = await createTestSite(company.id, project.id, 'Main Block');
  const sup = await createTestUser(app, company.id, 'site_supervisor', `${slug}-sup`);
  await assignUserToProject(company.id, project.id, sup.id, site.id);
  const url = `/api/v1/projects/${project.id}/sites/${site.id}/daily-reports`;

  const created = await app.inject({ method: 'POST', url, headers: auth(sup), payload: { reportDate: '2026-04-07' } });
  const content = { ...emptyContent(), remarks: 'Human remark', reviewedSections: ['remarks'] };
  const saved = await app.inject({
    method: 'PATCH', url: `${url}/${created.json().report.id}`, headers: auth(sup),
    payload: { rawInput: RAW, content, expectedUpdatedAt: created.json().report.updatedAt },
  });
  expect(saved.statusCode).toBe(200);
  const report = saved.json().report;
  return { company, admin, project, site, sup, url, report, content, reportUrl: `${url}/${report.id}` };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

const extract = (ctx: Ctx, user: TestUser = ctx.sup) =>
  app.inject({ method: 'POST', url: `${ctx.reportUrl}/extract`, headers: auth(user), payload: {} });

async function seedOperationalRows(ctx: Ctx) {
  const worker = await createTestWorker(ctx.company.id);
  await createTestLabourEntry(ctx.company.id, ctx.project.id, ctx.site.id, worker.id, ctx.admin.id);
  await createTestAttendanceRecord(ctx.company.id, ctx.project.id, ctx.site.id, worker.id, ctx.admin.id);
  await createTestDelivery(ctx.company.id, ctx.project.id, ctx.site.id, ctx.admin.id);
  const budget = await createTestBudget(ctx.company.id, ctx.project.id);
  await createTestLineItem(budget.id, ctx.company.id, ctx.project.id);
  await createTestInvoice(ctx.company.id, ctx.project.id);
}

async function operationalCounts() {
  const [labourEntry, attendanceRecord, inventoryTransaction, siteInventory, deliveryRecord, invoice, budgetLineItem, worker, dailyTarget, scheduleTask] =
    await Promise.all([
      prisma.labourEntry.count(), prisma.attendanceRecord.count(), prisma.inventoryTransaction.count(),
      prisma.siteInventory.count(), prisma.deliveryRecord.count(), prisma.invoice.count(),
      prisma.budgetLineItem.count(), prisma.worker.count(), prisma.dailyTarget.count(), prisma.scheduleTask.count(),
    ]);
  return { labourEntry, attendanceRecord, inventoryTransaction, siteInventory, deliveryRecord, invoice, budgetLineItem, worker, dailyTarget, scheduleTask };
}

const extractionAudits = (companyId: string) =>
  prisma.auditLog.findMany({ where: { companyId, entityType: 'daily_report_ai_extraction' }, orderBy: { createdAt: 'asc' } });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /:reportId/extract — success', () => {
  it('stores the draft in aiDraft only: content, rawInput and every operational table are unchanged', async () => {
    const ctx = await setup();
    await seedOperationalRows(ctx);
    const before = await operationalCounts();
    expect(before.labourEntry).toBe(1);
    const rowBefore = await prisma.dailyReport.findUniqueOrThrow({ where: { id: ctx.report.id } });

    const res = await extract(ctx);
    expect(res.statusCode).toBe(200);
    const report = res.json().report;
    expect(report.aiDraft).toEqual({ draft: DRAFT, unsupportedNumbers: [{ path: 'manpower.totalOnSite', value: 99 }] });
    expect(report).toMatchObject({ extractionStatus: 'succeeded', extractionError: null, aiModel: 'fake-model-1', rawInput: RAW });
    expect(report.content).toEqual(rowBefore.content);
    expect(report.content).toEqual(DailyReportContentV1.parse(ctx.content));

    const rowAfter = await prisma.dailyReport.findUniqueOrThrow({ where: { id: ctx.report.id } });
    expect(rowAfter.content).toEqual(rowBefore.content);
    expect(rowAfter.rawInput).toBe(RAW);
    expect(rowAfter.status).toBe('draft');
    expect(rowAfter.aiPromptVersion).toBe('dsr-v1-test');
    expect(rowAfter.aiUsage).toEqual(USAGE);
    // Only ai*/extraction* columns (and updatedAt) changed.
    const changed = (Object.keys(rowAfter) as Array<keyof typeof rowAfter>)
      .filter((k) => JSON.stringify(rowAfter[k]) !== JSON.stringify(rowBefore[k])).sort();
    expect(changed).toEqual(['aiDraft', 'aiModel', 'aiPromptVersion', 'aiUsage', 'extractionStatus', 'updatedAt']);

    expect(await operationalCounts()).toEqual(before);

    expect(calls).toEqual([{
      rawInput: RAW,
      context: { projectName: 'Lakeside Clinic', siteName: 'Main Block', reportDate: '2026-04-07', timezone: 'Africa/Nairobi' },
    }]);

    const audits = await extractionAudits(ctx.company.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityId: ctx.report.id, userId: ctx.sup.id });
    expect(audits[0].changesAfter).toMatchObject({ status: 'succeeded', model: 'fake-model-1', usage: USAGE, unsupportedNumberCount: 1 });
    const dump = JSON.stringify(await prisma.auditLog.findMany({ where: { companyId: ctx.company.id } }));
    expect(dump).not.toContain('RAWNOTE-kestrel');
    expect(dump).not.toContain(DRAFT_MARKER);
    expect(dump).not.toContain('Human remark');
  });

  it('rejects an empty rawInput with 422 and does not call the model', async () => {
    const ctx = await setup();
    await prisma.dailyReport.update({ where: { id: ctx.report.id }, data: { rawInput: '   ' } });
    const res = await extract(ctx);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(calls).toHaveLength(0);
  });
});

describe('POST /:reportId/extract — failure', () => {
  it.each([
    ['AI_DISABLED', 503], ['AI_UNAVAILABLE', 503], ['AI_BUSY', 503], ['AI_NO_DRAFT', 422], ['AI_ERROR', 502],
  ] as Array<[ExtractionErrorCode, number]>)('%s → %d, keeps rawInput and content, records the code', async (code, status) => {
    const ctx = await setup();
    const before = await prisma.dailyReport.findUniqueOrThrow({ where: { id: ctx.report.id } });
    mode = code;
    const res = await extract(ctx);
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: expect.any(String), code });

    const after = await prisma.dailyReport.findUniqueOrThrow({ where: { id: ctx.report.id } });
    expect(after).toMatchObject({ rawInput: RAW, extractionStatus: 'failed', extractionError: code, aiDraft: null, status: 'draft' });
    expect(after.content).toEqual(before.content);

    const audits = await extractionAudits(ctx.company.id);
    expect(audits).toHaveLength(1);
    expect(audits[0].changesAfter).toEqual({ status: 'failed', errorCode: code });

    const get = (await app.inject({ method: 'GET', url: ctx.reportUrl, headers: auth(ctx.sup) })).json().report;
    expect(get).toMatchObject({ rawInput: RAW, extractionStatus: 'failed', extractionError: code });
  });

  it('an unexpected extractor error is 502 AI_ERROR and leaks nothing', async () => {
    const ctx = await setup();
    mode = 'plain-error';
    const res = await extract(ctx);
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('AI_ERROR');
    expect(res.body).not.toContain('RAWNOTE');
    expect(res.body).not.toContain('upstream');
  });

  it('a draft that fails the schema is never stored (502 AI_ERROR)', async () => {
    const ctx = await setup();
    mode = 'invalid-draft';
    const res = await extract(ctx);
    expect(res.statusCode).toBe(502);
    const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: ctx.report.id } });
    expect(row.aiDraft).toBeNull();
    expect(row.extractionError).toBe('AI_ERROR');
  });

  it('a later failure keeps the previous successful draft', async () => {
    const ctx = await setup();
    expect((await extract(ctx)).statusCode).toBe(200);
    mode = 'AI_BUSY';
    expect((await extract(ctx)).statusCode).toBe(503);
    const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: ctx.report.id } });
    expect(row.aiDraft).toEqual({ draft: DRAFT, unsupportedNumbers: [{ path: 'manpower.totalOnSite', value: 99 }] });
    expect(row.extractionStatus).toBe('failed');
    expect(await extractionAudits(ctx.company.id)).toHaveLength(2);
  });
});

describe('per-company daily cap', () => {
  it('returns 429 AI_CAP_REACHED once today\'s extractions reach the cap, without calling the model', async () => {
    const ctx = await setup();
    const cap = env.DAILY_REPORT_AI_DAILY_CAP_PER_COMPANY;
    await prisma.auditLog.createMany({
      data: Array.from({ length: cap }, () => ({
        companyId: ctx.company.id, action: 'create' as const, entityType: 'daily_report_ai_extraction', entityId: ctx.report.id,
      })),
    });
    const res = await extract(ctx);
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('AI_CAP_REACHED');
    expect(calls).toHaveLength(0);
    const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: ctx.report.id } });
    expect(row.extractionStatus).toBe('not_requested');
  });

  it('only counts this company\'s extractions from today (UTC)', async () => {
    const ctx = await setup();
    const other = await createTestCompany(app, 'drx-other');
    const cap = env.DAILY_REPORT_AI_DAILY_CAP_PER_COMPANY;
    const yesterday = new Date(Date.now() - 36 * 3600 * 1000);
    await prisma.auditLog.createMany({
      data: [
        ...Array.from({ length: cap }, () => ({ companyId: other.company.id, action: 'create' as const, entityType: 'daily_report_ai_extraction' })),
        ...Array.from({ length: cap }, () => ({ companyId: ctx.company.id, action: 'create' as const, entityType: 'daily_report_ai_extraction', createdAt: yesterday })),
        ...Array.from({ length: cap - 1 }, () => ({ companyId: ctx.company.id, action: 'create' as const, entityType: 'daily_report_ai_extraction' })),
      ],
    });
    expect((await extract(ctx)).statusCode).toBe(200);
    expect((await extract(ctx)).statusCode).toBe(429);
  });
});
