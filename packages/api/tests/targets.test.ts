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
  assignUserToProject,
  createTestTarget,
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

const BASE = (pid: string, sid: string) =>
  `/api/v1/projects/${pid}/sites/${sid}/targets`;

// ─── POST — create ────────────────────────────────────────────────────────────

describe('POST /targets', () => {
  it('site_supervisor can create a target for assigned site', async () => {
    const { company } = await createTestCompany(app, 'tgt-create-1');
    const sup     = await createTestUser(app, company.id, 'site_supervisor', 'sup-tc1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: {
        date:        '2026-04-07',
        description: 'Pour concrete slab — Level 3',
        targetValue: 50,
        targetUnit:  'm³',
        notes:       'Need 3 mixers',
      },
    });

    expect(res.statusCode).toBe(201);
    const { target } = res.json();
    expect(target.description).toBe('Pour concrete slab — Level 3');
    expect(target.targetValue).toBe('50');
    expect(target.targetUnit).toBe('m³');
    expect(target.completionPct).toBeNull();
    expect(target.approvedById).toBeNull();
  });

  it('creates worker-specific target with optional workerId', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-create-2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        date:        '2026-04-07',
        description: 'Lay 30 courses of brickwork',
        targetValue: 30,
        targetUnit:  'courses',
        workerId:    worker.id,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().target.workerId).toBe(worker.id);
    expect(res.json().target.worker.firstName).toBe(worker.firstName);
  });

  it('records completionPct when actualValue provided', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-create-3');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        date:        '2026-04-07',
        description: 'Install windows',
        targetValue: 20,
        targetUnit:  'units',
        actualValue: 15,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().target.completionPct).toBe(75);
  });

  it('finance_officer cannot create target — 403', async () => {
    const { company } = await createTestCompany(app, 'tgt-create-4');
    const fo      = await createTestUser(app, company.id, 'finance_officer', 'fo-tc4');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${fo.accessToken}` },
      payload: { date: '2026-04-07', description: 'Test', targetValue: 10, targetUnit: 'units' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('site_supervisor on different site cannot create target — 404', async () => {
    const { company } = await createTestCompany(app, 'tgt-create-5');
    const sup    = await createTestUser(app, company.id, 'site_supervisor', 'sup-tc5');
    const project = await createTestProject(company.id);
    const siteA  = await createTestSite(company.id, project.id, 'Site A');
    const siteB  = await createTestSite(company.id, project.id, 'Site B');
    await assignUserToProject(company.id, project.id, sup.id, siteA.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, siteB.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { date: '2026-04-07', description: 'Test', targetValue: 10, targetUnit: 'units' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('rejects missing required fields — 422', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-create-6');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { date: '2026-04-07' }, // missing description, targetValue, targetUnit
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('writes audit log on create', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-create-audit');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { date: '2026-04-07', description: 'Test', targetValue: 10, targetUnit: 'units' },
    });

    const targetId = res.json().target.id;
    const log = await prisma.auditLog.findFirst({
      where: { action: 'create', entityType: 'daily_target', entityId: targetId },
    });
    expect(log).toBeTruthy();
  });
});

// ─── GET list ─────────────────────────────────────────────────────────────────

describe('GET /targets', () => {
  it('lists all targets for a site', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-list-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await createTestTarget(company.id, project.id, site.id, admin.id, { description: 'Target A' });
    await createTestTarget(company.id, project.id, site.id, admin.id, { description: 'Target B', date: new Date('2026-04-08') });

    const res = await app.inject({
      method: 'GET',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().targets).toHaveLength(2);
  });

  it('filters by date', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-list-2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await createTestTarget(company.id, project.id, site.id, admin.id, { date: new Date('2026-04-07') });
    await createTestTarget(company.id, project.id, site.id, admin.id, { date: new Date('2026-04-08') });

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}?date=2026-04-07`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().targets).toHaveLength(1);
  });

  it('filters by workerId', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-list-3');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await createTestTarget(company.id, project.id, site.id, admin.id, { workerId: worker.id });
    await createTestTarget(company.id, project.id, site.id, admin.id); // site-wide

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}?workerId=${worker.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().targets).toHaveLength(1);
    expect(res.json().targets[0].workerId).toBe(worker.id);
  });

  it('does not leak targets from another company', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'tgt-list-4a');
    const { company: c2, admin: a2 } = await createTestCompany(app, 'tgt-list-4b');
    const p1 = await createTestProject(c1.id);
    const p2 = await createTestProject(c2.id);
    const s1 = await createTestSite(c1.id, p1.id);
    const s2 = await createTestSite(c2.id, p2.id);
    await createTestTarget(c2.id, p2.id, s2.id, a2.id);

    const res = await app.inject({
      method: 'GET',
      url: BASE(p1.id, s1.id),
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().targets).toHaveLength(0);
  });

  it('includes completionPct in list results', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-list-5');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await createTestTarget(company.id, project.id, site.id, admin.id, {
      targetValue: 100,
      actualValue: 80,
    });

    const res = await app.inject({
      method: 'GET',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().targets[0].completionPct).toBe(80);
  });
});

// ─── GET /summary ─────────────────────────────────────────────────────────────

describe('GET /targets/summary', () => {
  it('returns correct summary stats', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-summary-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    // Create 3 targets on the same date
    const t1 = await createTestTarget(company.id, project.id, site.id, admin.id, {
      date: new Date('2026-04-07'),
      targetValue: 100,
      actualValue: 100,
    });
    await createTestTarget(company.id, project.id, site.id, admin.id, {
      date: new Date('2026-04-07'),
      targetValue: 50,
      actualValue: 25,
    });
    await createTestTarget(company.id, project.id, site.id, admin.id, {
      date: new Date('2026-04-07'),
      targetValue: 20,
      // no actual
    });

    // Approve one
    await prisma.dailyTarget.update({
      where: { id: t1.id },
      data: { approvedById: admin.id, approvedAt: new Date() },
    });

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}/summary?date=2026-04-07`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { summary } = res.json();
    expect(summary.total).toBe(3);
    expect(summary.approved).toBe(1);
    expect(summary.withActual).toBe(2);
    // avg completion: (100/100 + 25/50 + 0/20) * 100 / 3 = (100 + 50 + 0) / 3 = 50
    expect(summary.avgCompletion).toBe(50);
  });
});

// ─── GET single ───────────────────────────────────────────────────────────────

describe('GET /targets/:targetId', () => {
  it('returns target with setBy and worker details', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-get-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id, { firstName: 'Detail' });
    const tgt = await createTestTarget(company.id, project.id, site.id, admin.id, {
      workerId: worker.id,
    });

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}/${tgt.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().target.setBy.id).toBe(admin.id);
    expect(res.json().target.worker.firstName).toBe('Detail');
  });

  it('returns 404 for non-existent target', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-get-2');
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

describe('PATCH /targets/:targetId', () => {
  it('updates actualValue and recalculates completionPct', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-update-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const tgt = await createTestTarget(company.id, project.id, site.id, admin.id, {
      targetValue: 100,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE(project.id, site.id)}/${tgt.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { actualValue: 75 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().target.completionPct).toBe(75);
  });

  it('project_manager can update description and targetValue', async () => {
    const { company } = await createTestCompany(app, 'tgt-update-2');
    const admin = await createTestUser(app, company.id, 'company_admin', 'adm-tu2');
    const pm    = await createTestUser(app, company.id, 'project_manager', 'pm-tu2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, pm.id);
    const tgt = await createTestTarget(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE(project.id, site.id)}/${tgt.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { description: 'Updated description', targetValue: 200 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().target.description).toBe('Updated description');
  });

  it('writes audit log on update', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-update-audit');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const tgt = await createTestTarget(company.id, project.id, site.id, admin.id);

    await app.inject({
      method: 'PATCH',
      url: `${BASE(project.id, site.id)}/${tgt.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { notes: 'Updated' },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'update', entityType: 'daily_target', entityId: tgt.id },
    });
    expect(log).toBeTruthy();
  });
});

// ─── POST /approve ────────────────────────────────────────────────────────────

describe('POST /targets/:targetId/approve', () => {
  it('site_supervisor can approve a target for assigned site', async () => {
    const { company } = await createTestCompany(app, 'tgt-approve-1');
    const admin = await createTestUser(app, company.id, 'company_admin', 'adm-ta1');
    const sup   = await createTestUser(app, company.id, 'site_supervisor', 'sup-ta1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const tgt = await createTestTarget(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: `${BASE(project.id, site.id)}/${tgt.id}/approve`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { target } = res.json();
    expect(target.approvedById).toBe(sup.id);
    expect(target.approvedAt).toBeTruthy();
    expect(target.approvedBy).toBeTruthy();
  });

  it('company_admin can approve a target', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-approve-2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const tgt = await createTestTarget(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: `${BASE(project.id, site.id)}/${tgt.id}/approve`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().target.approvedById).toBe(admin.id);
  });

  it('cannot approve an already-approved target — 403', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-approve-3');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const tgt = await createTestTarget(company.id, project.id, site.id, admin.id);

    // First approval
    await app.inject({
      method: 'POST',
      url: `${BASE(project.id, site.id)}/${tgt.id}/approve`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    // Second attempt
    const res = await app.inject({
      method: 'POST',
      url: `${BASE(project.id, site.id)}/${tgt.id}/approve`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('finance_officer cannot approve — 403', async () => {
    const { company } = await createTestCompany(app, 'tgt-approve-4');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-ta4');
    const fo      = await createTestUser(app, company.id, 'finance_officer', 'fo-ta4');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const tgt = await createTestTarget(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: `${BASE(project.id, site.id)}/${tgt.id}/approve`,
      headers: { authorization: `Bearer ${fo.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on approval', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-approve-audit');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const tgt = await createTestTarget(company.id, project.id, site.id, admin.id);

    await app.inject({
      method: 'POST',
      url: `${BASE(project.id, site.id)}/${tgt.id}/approve`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'update', entityType: 'daily_target', entityId: tgt.id },
    });
    expect(log).toBeTruthy();
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /targets/:targetId', () => {
  it('company_admin can delete a target', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-delete-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const tgt = await createTestTarget(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `${BASE(project.id, site.id)}/${tgt.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);
    const check = await prisma.dailyTarget.findUnique({ where: { id: tgt.id } });
    expect(check).toBeNull();
  });

  it('site_supervisor cannot delete — 403', async () => {
    const { company } = await createTestCompany(app, 'tgt-delete-2');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-td2');
    const sup     = await createTestUser(app, company.id, 'site_supervisor', 'sup-td2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const tgt = await createTestTarget(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `${BASE(project.id, site.id)}/${tgt.id}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on delete', async () => {
    const { company, admin } = await createTestCompany(app, 'tgt-delete-audit');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const tgt = await createTestTarget(company.id, project.id, site.id, admin.id);

    await app.inject({
      method: 'DELETE',
      url: `${BASE(project.id, site.id)}/${tgt.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'delete', entityType: 'daily_target', entityId: tgt.id },
    });
    expect(log).toBeTruthy();
  });
});
