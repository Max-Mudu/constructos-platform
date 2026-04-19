import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestWorker,
  assignWorkerToSite,
  createTestLabourEntry,
  assignUserToProject,
  clearDatabase,
} from './helpers/fixtures';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE = (pid: string, sid: string) =>
  `/api/v1/projects/${pid}/sites/${sid}/labour`;

// ─── POST — create ────────────────────────────────────────────────────────────

describe('POST /labour', () => {
  it('company_admin can create a labour entry', async () => {
    const { company, admin } = await createTestCompany(app, 'lb-create-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        workerId:    worker.id,
        date:        '2026-04-07',
        hoursWorked: 8,
        dailyRate:   1800,
        currency:    'KES',
        notes:       'Regular site work',
      },
    });

    expect(res.statusCode).toBe(201);
    const { entry } = res.json();
    expect(entry.workerId).toBe(worker.id);
    expect(entry.hoursWorked).toBe('8');
    expect(entry.dailyRate).toBe('1800');
    expect(entry.worker.firstName).toBe(worker.firstName);
  });

  it('site_supervisor on assigned site can create a labour entry', async () => {
    const { company } = await createTestCompany(app, 'lb-create-2');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-lc2');
    const sup     = await createTestUser(app, company.id, 'site_supervisor', 'sup-lc2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: {
        workerId:    worker.id,
        date:        '2026-04-07',
        hoursWorked: 8,
        dailyRate:   1500,
      },
    });

    expect(res.statusCode).toBe(201);
  });

  it('site_supervisor on a different site cannot create a labour entry — 404', async () => {
    const { company } = await createTestCompany(app, 'lb-create-3');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-lc3');
    const sup     = await createTestUser(app, company.id, 'site_supervisor', 'sup-lc3');
    const project = await createTestProject(company.id);
    const siteA   = await createTestSite(company.id, project.id, 'Site A');
    const siteB   = await createTestSite(company.id, project.id, 'Site B');
    await assignUserToProject(company.id, project.id, sup.id, siteA.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, siteB.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, siteB.id),  // siteB — supervisor only has siteA
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { workerId: worker.id, date: '2026-04-07', hoursWorked: 8, dailyRate: 1500 },
    });

    expect(res.statusCode).toBe(404);
  });

  it('finance_officer cannot create a labour entry — 403', async () => {
    const { company } = await createTestCompany(app, 'lb-create-4');
    const fo      = await createTestUser(app, company.id, 'finance_officer', 'fo-lc4');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${fo.accessToken}` },
      payload: { workerId: '00000000-0000-0000-0000-000000000000', date: '2026-04-07', hoursWorked: 8, dailyRate: 1500 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects worker not assigned to the site — 403', async () => {
    const { company, admin } = await createTestCompany(app, 'lb-create-5');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    // Worker NOT assigned to site

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { workerId: worker.id, date: '2026-04-07', hoursWorked: 8, dailyRate: 1500 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects unknown workerId — 404', async () => {
    const { company, admin } = await createTestCompany(app, 'lb-create-6');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        workerId: '00000000-0000-0000-0000-000000000000',
        date: '2026-04-07',
        hoursWorked: 8,
        dailyRate: 1500,
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 422 on missing required fields', async () => {
    const { company, admin } = await createTestCompany(app, 'lb-create-7');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { date: '2026-04-07' }, // missing workerId, hoursWorked, dailyRate
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('writes audit log on create', async () => {
    const { company, admin } = await createTestCompany(app, 'lb-create-audit');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { workerId: worker.id, date: '2026-04-07', hoursWorked: 8, dailyRate: 1500 },
    });

    const entryId = res.json().entry.id;
    const log = await prisma.auditLog.findFirst({
      where: { action: 'create', entityType: 'labour_entry', entityId: entryId },
    });
    expect(log).toBeTruthy();
  });
});

// ─── GET list ─────────────────────────────────────────────────────────────────

describe('GET /labour', () => {
  it('company_admin can list entries for a site', async () => {
    const { company, admin } = await createTestCompany(app, 'lb-list-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const wA      = await createTestWorker(company.id, { firstName: 'A' });
    const wB      = await createTestWorker(company.id, { firstName: 'B' });
    await assignWorkerToSite(company.id, project.id, site.id, wA.id, admin.id);
    await assignWorkerToSite(company.id, project.id, site.id, wB.id, admin.id);
    await createTestLabourEntry(company.id, project.id, site.id, wA.id, admin.id, { date: new Date('2026-04-07') });
    await createTestLabourEntry(company.id, project.id, site.id, wB.id, admin.id, { date: new Date('2026-04-08') });

    const res = await app.inject({
      method: 'GET',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toHaveLength(2);
  });

  it('filters by date', async () => {
    const { company, admin } = await createTestCompany(app, 'lb-list-2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const wA      = await createTestWorker(company.id, { firstName: 'A' });
    const wB      = await createTestWorker(company.id, { firstName: 'B' });
    await assignWorkerToSite(company.id, project.id, site.id, wA.id, admin.id);
    await assignWorkerToSite(company.id, project.id, site.id, wB.id, admin.id);
    await createTestLabourEntry(company.id, project.id, site.id, wA.id, admin.id, { date: new Date('2026-04-07') });
    await createTestLabourEntry(company.id, project.id, site.id, wB.id, admin.id, { date: new Date('2026-04-08') });

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}?date=2026-04-07`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toHaveLength(1);
  });

  it('does not leak entries from another company', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'lb-list-3a');
    const { company: c2, admin: a2 } = await createTestCompany(app, 'lb-list-3b');
    const p1 = await createTestProject(c1.id);
    const p2 = await createTestProject(c2.id);
    const s1 = await createTestSite(c1.id, p1.id);
    const s2 = await createTestSite(c2.id, p2.id);
    const w2 = await createTestWorker(c2.id);
    await assignWorkerToSite(c2.id, p2.id, s2.id, w2.id, a2.id);
    await createTestLabourEntry(c2.id, p2.id, s2.id, w2.id, a2.id);

    const res = await app.inject({
      method: 'GET',
      url: BASE(p1.id, s1.id),
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toHaveLength(0);
  });

  it('finance_officer can view labour entries', async () => {
    const { company } = await createTestCompany(app, 'lb-list-4');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-ll4');
    const fo      = await createTestUser(app, company.id, 'finance_officer', 'fo-ll4');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'GET',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${fo.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toHaveLength(1);
  });

  it('site_supervisor cannot see entries for a different site — 404', async () => {
    const { company } = await createTestCompany(app, 'lb-list-5');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-ll5');
    const sup     = await createTestUser(app, company.id, 'site_supervisor', 'sup-ll5');
    const project = await createTestProject(company.id);
    const siteA   = await createTestSite(company.id, project.id, 'Site A');
    const siteB   = await createTestSite(company.id, project.id, 'Site B');
    await assignUserToProject(company.id, project.id, sup.id, siteA.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, siteB.id, worker.id, admin.id);
    await createTestLabourEntry(company.id, project.id, siteB.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'GET',
      url: BASE(project.id, siteB.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── GET single ───────────────────────────────────────────────────────────────

describe('GET /labour/:entryId', () => {
  it('returns entry with worker and registeredBy details', async () => {
    const { company, admin } = await createTestCompany(app, 'lb-get-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id, { firstName: 'Detail' });
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const entry = await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}/${entry.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { entry: e } = res.json();
    expect(e.worker.firstName).toBe('Detail');
    expect(e.registeredBy.id).toBe(admin.id);
  });

  it('returns 404 for non-existent entry', async () => {
    const { company, admin } = await createTestCompany(app, 'lb-get-2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}/00000000-0000-0000-0000-000000000000`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

describe('PATCH /labour/:entryId', () => {
  it('company_admin can update hours and rate', async () => {
    const { company, admin } = await createTestCompany(app, 'lb-update-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const entry = await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE(project.id, site.id)}/${entry.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { hoursWorked: 6, notes: 'Half day' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().entry.hoursWorked).toBe('6');
    expect(res.json().entry.notes).toBe('Half day');
  });

  it('finance_officer cannot update — 403', async () => {
    const { company } = await createTestCompany(app, 'lb-update-2');
    const fo      = await createTestUser(app, company.id, 'finance_officer', 'fo-lu2');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-lu2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const entry = await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE(project.id, site.id)}/${entry.id}`,
      headers: { authorization: `Bearer ${fo.accessToken}` },
      payload: { hoursWorked: 4 },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on update', async () => {
    const { company, admin } = await createTestCompany(app, 'lb-update-audit');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const entry = await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id);

    await app.inject({
      method: 'PATCH',
      url: `${BASE(project.id, site.id)}/${entry.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { notes: 'Updated' },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'update', entityType: 'labour_entry', entityId: entry.id },
    });
    expect(log).toBeTruthy();
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /labour/:entryId', () => {
  it('company_admin can delete a labour entry', async () => {
    const { company, admin } = await createTestCompany(app, 'lb-delete-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const entry = await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `${BASE(project.id, site.id)}/${entry.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);

    const check = await prisma.labourEntry.findUnique({ where: { id: entry.id } });
    expect(check).toBeNull();
  });

  it('site_supervisor cannot delete a labour entry — 403', async () => {
    const { company } = await createTestCompany(app, 'lb-delete-2');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-ld2');
    const sup     = await createTestUser(app, company.id, 'site_supervisor', 'sup-ld2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const entry = await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `${BASE(project.id, site.id)}/${entry.id}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on delete', async () => {
    const { company, admin } = await createTestCompany(app, 'lb-delete-audit');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    const entry = await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id);

    await app.inject({
      method: 'DELETE',
      url: `${BASE(project.id, site.id)}/${entry.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'delete', entityType: 'labour_entry', entityId: entry.id },
    });
    expect(log).toBeTruthy();
  });
});
