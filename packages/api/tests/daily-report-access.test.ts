/**
 * Daily Site Report V1 — access control: role × route matrix, supervisor
 * site scope, project membership, tenant isolation, draft-input visibility.
 */
import { FastifyInstance, InjectOptions } from 'fastify';
import { UserRole } from '@prisma/client';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { MemoryStorageDriver } from '../src/services/storage/memory';
import { RenderDailyReportPdf } from '../src/services/daily-report/pdf/types';
import { ReportExtractor } from '../src/services/daily-report/extractor/types';
import { DailyReportDraftV1, SECTION_KEYS, emptyContent } from '../src/services/daily-report/content.schema';
import {
  assignUserToProject, buildMultipartFile, clearDatabase, createTestCompany, createTestDailyReport,
  createTestProject, createTestSite, createTestUser, TEST_JPEG_BYTES, TestUser,
} from './helpers/fixtures';

const storage = new MemoryStorageDriver();
const renderPdf: RenderDailyReportPdf = async () => Buffer.from('%PDF-1.4 access-test');
const extractor: ReportExtractor = {
  async extract() {
    return {
      draft: DailyReportDraftV1.parse({}),
      unsupportedNumbers: [],
      model: 'fake-model',
      promptVersion: 'test-v1',
      usage: {
        inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        latencyMs: 1, stopReason: 'end_turn', requestId: null,
      },
    };
  },
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
});

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.accessToken}` });
const base = (projectId: string, siteId: string) => `/api/v1/projects/${projectId}/sites/${siteId}/daily-reports`;

const reviewed = () => ({ ...emptyContent(), reviewedSections: [...SECTION_KEYS] });

/** A site with a reviewed draft (with one photo) and a final report with a stored PDF. */
async function seedSite(companyId: string, projectId: string, siteId: string, preparedById: string) {
  const draft = await createTestDailyReport(companyId, projectId, siteId, preparedById, {
    reportDate: '2026-04-07', rawInput: 'secret site notes', content: reviewed(),
  });
  const photoKey = `daily-reports/${companyId}/${draft.id}/photos/seed.jpg`;
  await storage.put(photoKey, TEST_JPEG_BYTES, { contentType: 'image/jpeg' });
  const photo = await prisma.dailyReportPhoto.create({
    data: {
      companyId, dailyReportId: draft.id, fileKey: photoKey, fileName: 'seed.jpg', fileType: 'image/jpeg',
      fileSizeBytes: TEST_JPEG_BYTES.length, sha256: 'a'.repeat(64), uploadedById: preparedById,
    },
  });
  const final = await createTestDailyReport(companyId, projectId, siteId, preparedById, {
    reportDate: '2026-04-06', status: 'final', content: reviewed(),
  });
  const pdfKey = `daily-reports/${companyId}/${final.id}/rev-0.pdf`;
  await storage.put(pdfKey, Buffer.from('%PDF-1.4 seeded'), { contentType: 'application/pdf' });
  await prisma.dailyReport.update({ where: { id: final.id }, data: { pdfFileKey: pdfKey, contentHash: 'b'.repeat(64), finalisedById: preparedById, finalisedAt: new Date() } });
  await prisma.dailyReportRevision.create({
    data: {
      companyId, dailyReportId: final.id, revision: 0, content: reviewed(), contentSchemaVersion: 1, photos: [],
      pdfFileKey: pdfKey, contentHash: 'b'.repeat(64), finalisedById: preparedById, finalisedAt: new Date(),
    },
  });
  return { draftId: draft.id, finalId: final.id, photoId: photo.id };
}

async function setup() {
  const { company, admin } = await createTestCompany(app, 'dra');
  const project = await createTestProject(company.id, 'Harbour Tower');
  const siteA = await createTestSite(company.id, project.id, 'Site A');
  const siteB = await createTestSite(company.id, project.id, 'Site B');
  const a = await seedSite(company.id, project.id, siteA.id, admin.id);
  const b = await seedSite(company.id, project.id, siteB.id, admin.id);

  const users: Partial<Record<UserRole, TestUser>> = { company_admin: admin };
  for (const role of ['project_manager', 'site_supervisor', 'finance_officer', 'viewer', 'contractor', 'consultant', 'worker', 'super_admin'] as UserRole[]) {
    const u = await createTestUser(app, company.id, role, `dra-${role}`);
    users[role] = u;
    if (role === 'site_supervisor') await assignUserToProject(company.id, project.id, u.id, siteA.id);
    else if (role !== 'finance_officer' && role !== 'super_admin') await assignUserToProject(company.id, project.id, u.id);
  }
  return { company, admin, project, siteA, siteB, a, b, users: users as Record<UserRole, TestUser> };
}

type Ctx = Awaited<ReturnType<typeof setup>>;
type Seed = Ctx['a'];

/**
 * One request per contract route, against the given site's seeded records.
 * Requests run in order and each reads the current updatedAt, so editors'
 * calls succeed in sequence (the seeded photo is deleted before finalise).
 */
async function callAll(user: TestUser, projectId: string, siteId: string, seed: Seed) {
  const url = base(projectId, siteId);
  const h = auth(user);
  const ts = async (id: string) =>
    ((await prisma.dailyReport.findUnique({ where: { id } }))?.updatedAt ?? new Date()).toISOString();
  type Opts = InjectOptions;
  const reqs: Array<[string, () => Promise<Opts>]> = [
    ['list',        async () => ({ method: 'GET',    url, headers: h })],
    ['create',      async () => ({ method: 'POST',   url, headers: h, payload: { reportDate: '2026-04-10' } })],
    ['get',         async () => ({ method: 'GET',    url: `${url}/${seed.draftId}`, headers: h })],
    ['patch',       async () => ({ method: 'PATCH',  url: `${url}/${seed.draftId}`, headers: h, payload: { rawInput: 'edit', expectedUpdatedAt: await ts(seed.draftId) } })],
    ['extract',     async () => ({ method: 'POST',   url: `${url}/${seed.draftId}/extract`, headers: h, payload: {} })],
    ['photoUpload', async () => {
      const mp = buildMultipartFile('x.jpg', 'image/jpeg', TEST_JPEG_BYTES);
      return { method: 'POST', url: `${url}/${seed.draftId}/photos`, headers: { ...h, ...mp.headers }, payload: mp.body };
    }],
    ['photoPatch',  async () => ({ method: 'PATCH',  url: `${url}/${seed.draftId}/photos/${seed.photoId}`, headers: h, payload: { caption: 'c' } })],
    ['photoDelete', async () => ({ method: 'DELETE', url: `${url}/${seed.draftId}/photos/${seed.photoId}`, headers: h })],
    ['finalise',    async () => ({ method: 'POST',   url: `${url}/${seed.draftId}/finalise`, headers: h, payload: { expectedUpdatedAt: await ts(seed.draftId) } })],
    ['reopen',      async () => ({ method: 'POST',   url: `${url}/${seed.finalId}/reopen`, headers: h, payload: { reason: 'Needs a fix', expectedUpdatedAt: await ts(seed.finalId) } })],
    ['pdf',         async () => ({ method: 'GET',    url: `${url}/${seed.finalId}/pdf`, headers: h })],
  ];
  const out: Record<string, number> = {};
  for (const [name, build] of reqs) out[name] = (await app.inject(await build())).statusCode;
  return out;
}

const ALL_ROUTES = ['list', 'create', 'get', 'patch', 'extract', 'photoUpload', 'photoPatch', 'photoDelete', 'finalise', 'reopen', 'pdf'];
const every = (status: number) => Object.fromEntries(ALL_ROUTES.map((r) => [r, status]));

describe('role × route matrix', () => {
  // consultant moved to its own read-only matrix below (approved 2026-11-06)
  it.each(['contractor', 'worker', 'super_admin'] as UserRole[])('%s gets 403 on every route', async (role) => {
    const ctx = await setup();
    expect(await callAll(ctx.users[role], ctx.project.id, ctx.siteA.id, ctx.a)).toEqual(every(403));
  });

  it.each(['viewer', 'finance_officer'] as UserRole[])('%s can list, read and download, and nothing else', async (role) => {
    const ctx = await setup();
    expect(await callAll(ctx.users[role], ctx.project.id, ctx.siteA.id, ctx.a)).toEqual({
      ...every(403), list: 200, get: 200, pdf: 200,
    });
  });

  it.each(['viewer', 'finance_officer'] as UserRole[])('%s never receives rawInput or AI fields', async (role) => {
    const ctx = await setup();
    await prisma.dailyReport.update({
      where: { id: ctx.a.draftId },
      data: { aiDraft: { draft: DailyReportDraftV1.parse({}), unsupportedNumbers: [] }, aiModel: 'm', extractionStatus: 'succeeded' },
    });
    const res = await app.inject({ method: 'GET', url: `${base(ctx.project.id, ctx.siteA.id)}/${ctx.a.draftId}`, headers: auth(ctx.users[role]) });
    expect(res.statusCode).toBe(200);
    const report = res.json().report;
    for (const k of ['rawInput', 'aiDraft', 'extractionStatus', 'extractionError', 'aiModel', 'aiUsage', 'aiPromptVersion']) {
      expect(report).not.toHaveProperty(k);
    }
    expect(res.body).not.toContain('secret site notes');
    expect(report).toMatchObject({ canEdit: false, canReopen: false });
    expect(report.photos).toHaveLength(1);
    expect(report.photos[0].url).toEqual(expect.any(String));
  });

  it.each(['company_admin', 'project_manager', 'site_supervisor'] as UserRole[])('%s (editor) receives rawInput and AI fields and can edit', async (role) => {
    const ctx = await setup();
    const url = `${base(ctx.project.id, ctx.siteA.id)}/${ctx.a.draftId}`;
    const res = await app.inject({ method: 'GET', url, headers: auth(ctx.users[role]) });
    expect(res.statusCode).toBe(200);
    const report = res.json().report;
    expect(report).toMatchObject({
      rawInput: 'secret site notes', aiDraft: null, extractionStatus: 'not_requested', extractionError: null, aiModel: null,
      canEdit: true, canReopen: false,
    });
    const p = await app.inject({ method: 'PATCH', url, headers: auth(ctx.users[role]), payload: { rawInput: 'edited', expectedUpdatedAt: report.updatedAt } });
    expect(p.statusCode).toBe(200);
  });

  it('editors get 2xx on every route except reopen, which only admin / PM may use', async () => {
    const ctx = await setup();
    const sup = await callAll(ctx.users.site_supervisor, ctx.project.id, ctx.siteA.id, ctx.a);
    // Sequential calls mutate state: the photo is deleted before finalise; finalise is last for the draft.
    expect(sup).toEqual({
      list: 200, create: 201, get: 200, patch: 200, extract: 200, photoUpload: 201, photoPatch: 200,
      photoDelete: 204, finalise: 200, reopen: 403, pdf: 200,
    });
    const pmSeed = ctx.b;
    const pm = await callAll(ctx.users.project_manager, ctx.project.id, ctx.siteB.id, pmSeed);
    expect(pm).toEqual({
      list: 200, create: 201, get: 200, patch: 200, extract: 200, photoUpload: 201, photoPatch: 200,
      photoDelete: 204, finalise: 200, reopen: 200, pdf: 200,
    });
    const final = await app.inject({ method: 'GET', url: `${base(ctx.project.id, ctx.siteB.id)}/${pmSeed.draftId}`, headers: auth(ctx.users.company_admin) });
    expect(final.json().report).toMatchObject({ status: 'final', canEdit: false, canReopen: true });
  });
});

describe('scope', () => {
  it('a supervisor assigned to site A gets 404 on every site-B route (reopen is 403 by role first)', async () => {
    const ctx = await setup();
    expect(await callAll(ctx.users.site_supervisor, ctx.project.id, ctx.siteB.id, ctx.b)).toEqual({
      ...every(404), reopen: 403,
    });
    // Nothing on site B changed.
    expect(await prisma.dailyReport.count({ where: { siteId: ctx.siteB.id } })).toBe(2);
    expect(await prisma.dailyReportPhoto.count({ where: { dailyReportId: ctx.b.draftId } })).toBe(1);
  });

  it('a supervisor with a project-wide membership can use site B', async () => {
    const ctx = await setup();
    const wide = await createTestUser(app, ctx.company.id, 'site_supervisor', 'dra-wide');
    await assignUserToProject(ctx.company.id, ctx.project.id, wide.id);
    const res = await app.inject({ method: 'GET', url: `${base(ctx.project.id, ctx.siteB.id)}/${ctx.b.draftId}`, headers: auth(wide) });
    expect(res.statusCode).toBe(200);
  });

  it('a report addressed through the wrong site URL is 404, even for an admin', async () => {
    const ctx = await setup();
    const url = `${base(ctx.project.id, ctx.siteB.id)}/${ctx.a.draftId}`;
    for (const r of [
      await app.inject({ method: 'GET', url, headers: auth(ctx.admin) }),
      await app.inject({ method: 'GET', url: `${url}/pdf`, headers: auth(ctx.admin) }),
      await app.inject({ method: 'DELETE', url: `${url}/photos/${ctx.a.photoId}`, headers: auth(ctx.admin) }),
      await app.inject({ method: 'DELETE', url: `${base(ctx.project.id, ctx.siteB.id)}/${ctx.b.draftId}/photos/${ctx.a.photoId}`, headers: auth(ctx.admin) }),
    ]) {
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe('NOT_FOUND');
    }
    expect(await prisma.dailyReportPhoto.count()).toBe(2);
  });

  it('a project manager who is not a project member gets 403', async () => {
    const ctx = await setup();
    const outsider = await createTestUser(app, ctx.company.id, 'project_manager', 'dra-outsider');
    const res = await app.inject({ method: 'GET', url: base(ctx.project.id, ctx.siteA.id), headers: auth(outsider) });
    expect(res.statusCode).toBe(403);
    const status = await callAll(outsider, ctx.project.id, ctx.siteA.id, ctx.a);
    expect(Object.values(status).every((s) => s === 403)).toBe(true);
  });

  it('another tenant gets 404 on every route', async () => {
    const ctx = await setup();
    const { admin: otherAdmin } = await createTestCompany(app, 'dra-other');
    expect(await callAll(otherAdmin, ctx.project.id, ctx.siteA.id, ctx.a)).toEqual(every(404));
    const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: ctx.a.draftId } });
    expect(row.rawInput).toBe('secret site notes');
  });

  it('a site from another project is 404', async () => {
    const ctx = await setup();
    const p2 = await createTestProject(ctx.company.id, 'Other Project');
    const s2 = await createTestSite(ctx.company.id, p2.id, 'Elsewhere');
    const res = await app.inject({ method: 'GET', url: base(ctx.project.id, s2.id), headers: auth(ctx.admin) });
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const ctx = await setup();
    const res = await app.inject({ method: 'GET', url: base(ctx.project.id, ctx.siteA.id) });
    expect(res.statusCode).toBe(401);
  });
});

// ─── Approved access decisions (2026-11-06) ──────────────────────────────────

/** Read routes answer per scope; every write route is refused by role first. */
const readOnly = (read: number) => ({ ...every(403), list: read, get: read, pdf: read });
const getReport = (u: TestUser, projectId: string, siteId: string, id: string) =>
  app.inject({ method: 'GET', url: `${base(projectId, siteId)}/${id}`, headers: auth(u) });

describe('viewer site scope', () => {
  it('a viewer assigned to site A cannot read site B (404), only site A', async () => {
    const ctx = await setup();
    const v = await createTestUser(app, ctx.company.id, 'viewer', 'dra-viewer-a');
    await assignUserToProject(ctx.company.id, ctx.project.id, v.id, ctx.siteA.id);
    expect(await callAll(v, ctx.project.id, ctx.siteB.id, ctx.b)).toEqual(readOnly(404));
    expect(await callAll(v, ctx.project.id, ctx.siteA.id, ctx.a)).toEqual(readOnly(200));
  });

  it('a viewer with a project-wide membership (siteId null) can read site B', async () => {
    const ctx = await setup(); // setup() assigns the viewer project-wide
    expect(await callAll(ctx.users.viewer, ctx.project.id, ctx.siteB.id, ctx.b)).toEqual(readOnly(200));
  });
});

describe('consultant: read-only within their scope', () => {
  async function consultantOn(ctx: Ctx, siteId?: string, suffix = 'dra-cons-a') {
    const c = await createTestUser(app, ctx.company.id, 'consultant', suffix);
    await assignUserToProject(ctx.company.id, ctx.project.id, c.id, siteId);
    return c;
  }

  it('reads draft and final reports on the assigned site, and the list shows both', async () => {
    const ctx = await setup();
    const c = await consultantOn(ctx, ctx.siteA.id);
    const draft = await getReport(c, ctx.project.id, ctx.siteA.id, ctx.a.draftId);
    const final = await getReport(c, ctx.project.id, ctx.siteA.id, ctx.a.finalId);
    expect([draft.statusCode, final.statusCode]).toEqual([200, 200]);
    expect(draft.json().report.status).toBe('draft');
    expect(final.json().report.status).toBe('final');
    const list = await app.inject({ method: 'GET', url: base(ctx.project.id, ctx.siteA.id), headers: auth(c) });
    expect(list.statusCode).toBe(200);
    expect(list.json().reports.map((r: { id: string }) => r.id).sort()).toEqual([ctx.a.draftId, ctx.a.finalId].sort());
    const pdf = await app.inject({ method: 'GET', url: `${base(ctx.project.id, ctx.siteA.id)}/${ctx.a.finalId}/pdf`, headers: auth(c) });
    expect(pdf.statusCode).toBe(200);
  });

  it('never receives raw notes or AI drafting inputs, and is not offered edit or reopen', async () => {
    const ctx = await setup();
    const c = await consultantOn(ctx, ctx.siteA.id);
    await prisma.dailyReport.update({
      where: { id: ctx.a.draftId },
      data: { aiDraft: { draft: DailyReportDraftV1.parse({ remarks: 'AI-DRAFT-MARKER' }), unsupportedNumbers: [] }, aiModel: 'm', extractionStatus: 'succeeded' },
    });
    const res = await getReport(c, ctx.project.id, ctx.siteA.id, ctx.a.draftId);
    expect(res.statusCode).toBe(200);
    const report = res.json().report;
    for (const k of ['rawInput', 'aiDraft', 'extractionStatus', 'extractionError', 'aiModel', 'aiUsage', 'aiPromptVersion']) {
      expect(report).not.toHaveProperty(k);
    }
    expect(res.body).not.toContain('secret site notes');
    expect(res.body).not.toContain('AI-DRAFT-MARKER');
    expect(report).toMatchObject({ canEdit: false, canReopen: false });
  });

  it('gets 403 on every write route and changes nothing', async () => {
    const ctx = await setup();
    const c = await consultantOn(ctx, ctx.siteA.id);
    const before = await prisma.dailyReport.findMany({ where: { siteId: ctx.siteA.id }, orderBy: { id: 'asc' } });
    expect(await callAll(c, ctx.project.id, ctx.siteA.id, ctx.a)).toEqual(readOnly(200));
    const after = await prisma.dailyReport.findMany({ where: { siteId: ctx.siteA.id }, orderBy: { id: 'asc' } });
    expect(after).toEqual(before);
    expect(await prisma.dailyReportPhoto.count({ where: { dailyReportId: ctx.a.draftId } })).toBe(1);
    expect(await prisma.dailyReport.count({ where: { siteId: ctx.siteA.id } })).toBe(2); // create refused
  });

  it("cannot read another site's reports when assigned to site A (404)", async () => {
    const ctx = await setup();
    const c = await consultantOn(ctx, ctx.siteA.id);
    expect(await callAll(c, ctx.project.id, ctx.siteB.id, ctx.b)).toEqual(readOnly(404));
  });

  it('with a project-wide membership reads every site of that project', async () => {
    const ctx = await setup();
    const c = await consultantOn(ctx, undefined, 'dra-cons-wide');
    expect(await callAll(c, ctx.project.id, ctx.siteB.id, ctx.b)).toEqual(readOnly(200));
  });

  it('cannot read a project they are not a member of (403)', async () => {
    const ctx = await setup();
    const c = await consultantOn(ctx, ctx.siteA.id);
    const p2 = await createTestProject(ctx.company.id, 'Unrelated Project');
    const s2 = await createTestSite(ctx.company.id, p2.id, 'Unrelated Site');
    const res = await app.inject({ method: 'GET', url: base(p2.id, s2.id), headers: auth(c) });
    expect(res.statusCode).toBe(403);
  });
});

describe('finance officer, project manager and supervisor rules are unchanged', () => {
  it('finance officer reads every project and site company-wide without membership, and writes nothing', async () => {
    const ctx = await setup();
    const p2 = await createTestProject(ctx.company.id, 'Second Project');
    const s2 = await createTestSite(ctx.company.id, p2.id, 'Second Site');
    const seed2 = await seedSite(ctx.company.id, p2.id, s2.id, ctx.admin.id);
    const fin = ctx.users.finance_officer;
    expect(await prisma.projectMember.count({ where: { userId: fin.id } })).toBe(0);
    expect(await callAll(fin, ctx.project.id, ctx.siteB.id, ctx.b)).toEqual(readOnly(200));
    expect(await callAll(fin, p2.id, s2.id, seed2)).toEqual(readOnly(200));
  });

  it('a project manager whose membership names site A (as C1 user creation does) keeps project-wide access', async () => {
    const ctx = await setup();
    const pm = await createTestUser(app, ctx.company.id, 'project_manager', 'dra-pm-site-a');
    await assignUserToProject(ctx.company.id, ctx.project.id, pm.id, ctx.siteA.id);
    const res = await getReport(pm, ctx.project.id, ctx.siteB.id, ctx.b.draftId);
    expect(res.statusCode).toBe(200);
    expect(res.json().report.canEdit).toBe(true);
    const p = await app.inject({
      method: 'PATCH', url: `${base(ctx.project.id, ctx.siteB.id)}/${ctx.b.draftId}`, headers: auth(pm),
      payload: { rawInput: 'PM edit on site B', expectedUpdatedAt: res.json().report.updatedAt },
    });
    expect(p.statusCode).toBe(200);
  });

  it('a supervisor assigned to site A still gets 404 on site B and keeps editing site A', async () => {
    const ctx = await setup();
    const sup = ctx.users.site_supervisor;
    expect((await getReport(sup, ctx.project.id, ctx.siteB.id, ctx.b.draftId)).statusCode).toBe(404);
    const res = await getReport(sup, ctx.project.id, ctx.siteA.id, ctx.a.draftId);
    expect(res.statusCode).toBe(200);
    expect(res.json().report.canEdit).toBe(true);
  });
});

describe('cross-company and signed photo links', () => {
  it('every read role of another company gets 404 on every route, PDFs included', async () => {
    const ctx = await setup();
    const { company: other, admin: otherAdmin } = await createTestCompany(app, 'dra-other-co');
    const otherProject = await createTestProject(other.id, 'Other Co Project');
    const otherSite = await createTestSite(other.id, otherProject.id, 'Other Co Site');
    const outsiders: TestUser[] = [otherAdmin];
    for (const role of ['finance_officer', 'viewer', 'consultant', 'project_manager', 'site_supervisor'] as UserRole[]) {
      const u = await createTestUser(app, other.id, role, `dra-xco-${role}`);
      if (role !== 'finance_officer') await assignUserToProject(other.id, otherProject.id, u.id, otherSite.id);
      outsiders.push(u);
    }
    for (const u of outsiders) {
      const s = await callAll(u, ctx.project.id, ctx.siteA.id, ctx.a);
      // Reads (incl. the PDF) are 404; writes are refused by role (403) or project (404) — never 2xx.
      expect({ list: s.list, get: s.get, pdf: s.pdf }).toEqual({ list: 404, get: 404, pdf: 404 });
      expect(Object.values(s).every((code) => code === 403 || code === 404)).toBe(true);
    }
    const row = await prisma.dailyReport.findUniqueOrThrow({ where: { id: ctx.a.draftId } });
    expect(row.rawInput).toBe('secret site notes');
    expect(await prisma.dailyReportPhoto.count({ where: { dailyReportId: ctx.a.draftId } })).toBe(1);
  });

  it('a signed photo link is issued only through an authorised read', async () => {
    const ctx = await setup();
    const v = await createTestUser(app, ctx.company.id, 'viewer', 'dra-viewer-links');
    await assignUserToProject(ctx.company.id, ctx.project.id, v.id, ctx.siteA.id);
    const c = await createTestUser(app, ctx.company.id, 'consultant', 'dra-cons-links');
    await assignUserToProject(ctx.company.id, ctx.project.id, c.id, ctx.siteA.id);
    const { admin: otherAdmin } = await createTestCompany(app, 'dra-links-other');

    // Unauthorised: viewer / consultant of site A asking for site B; another company asking for site A.
    for (const [u, siteId, id] of [[v, ctx.siteB.id, ctx.b.draftId], [c, ctx.siteB.id, ctx.b.draftId], [otherAdmin, ctx.siteA.id, ctx.a.draftId]] as const) {
      const res = await getReport(u, ctx.project.id, siteId, id);
      expect(res.statusCode).toBe(404);
      expect(Object.keys(res.json()).sort()).toEqual(['code', 'error']); // no report, no photos, no URLs
      expect(res.body).not.toContain('seed.jpg');
    }
    // Authorised: the consultant's own site gets a signed URL for its photo.
    const ok = await getReport(c, ctx.project.id, ctx.siteA.id, ctx.a.draftId);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().report.photos).toHaveLength(1);
    expect(ok.json().report.photos[0].url).toEqual(expect.any(String));
  });
});
