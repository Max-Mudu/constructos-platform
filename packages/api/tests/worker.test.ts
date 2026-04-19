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

// ─── POST /workers ────────────────────────────────────────────────────────────

describe('POST /workers', () => {
  it('company_admin can create a worker', async () => {
    const { admin } = await createTestCompany(app, 'wk-create-1');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        firstName: 'James',
        lastName:  'Kariuki',
        trade:     'Mason',
        phone:     '+254700000001',
        dailyWage: 1800,
        currency:  'KES',
        emergencyContactName:  'Mary Kariuki',
        emergencyContactPhone: '+254700000002',
      },
    });

    expect(res.statusCode).toBe(201);
    const { worker } = res.json();
    expect(worker.firstName).toBe('James');
    expect(worker.lastName).toBe('Kariuki');
    expect(worker.trade).toBe('Mason');
    expect(worker.isActive).toBe(true);
    expect(worker.employmentStatus).toBe('active');
  });

  it('project_manager can create a worker', async () => {
    const { company } = await createTestCompany(app, 'wk-create-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-wc2');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { firstName: 'Ali', lastName: 'Hassan' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('site_supervisor cannot create a worker — 403', async () => {
    const { company } = await createTestCompany(app, 'wk-create-3');
    const sup = await createTestUser(app, company.id, 'site_supervisor', 'sup-wc3');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { firstName: 'X', lastName: 'Y' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated request returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      payload: { firstName: 'X', lastName: 'Y' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 422 on missing required fields', async () => {
    const { admin } = await createTestCompany(app, 'wk-create-4');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { firstName: 'NoLastName' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('writes audit log on create', async () => {
    const { admin } = await createTestCompany(app, 'wk-create-audit');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workers',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { firstName: 'Audit', lastName: 'Worker' },
    });

    const workerId = res.json().worker.id;
    const log = await prisma.auditLog.findFirst({
      where: { action: 'create', entityType: 'worker', entityId: workerId },
    });
    expect(log).toBeTruthy();
    expect(log?.userId).toBe(admin.id);
  });
});

// ─── GET /workers ─────────────────────────────────────────────────────────────

describe('GET /workers', () => {
  it('company_admin sees all active workers', async () => {
    const { company, admin } = await createTestCompany(app, 'wk-list-1');
    await createTestWorker(company.id, { firstName: 'A' });
    await createTestWorker(company.id, { firstName: 'B' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workers',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().workers).toHaveLength(2);
  });

  it('does not leak workers from another company', async () => {
    const { admin: a1 } = await createTestCompany(app, 'wk-list-2a');
    const { company: c2 } = await createTestCompany(app, 'wk-list-2b');
    await createTestWorker(c2.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workers',
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.json().workers).toHaveLength(0);
  });

  it('site_supervisor sees only workers assigned to their sites', async () => {
    const { company } = await createTestCompany(app, 'wk-list-3');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-wl3');
    const sup     = await createTestUser(app, company.id, 'site_supervisor', 'sup-wl3');
    const project = await createTestProject(company.id);
    const siteA   = await createTestSite(company.id, project.id, 'Site A');
    const siteB   = await createTestSite(company.id, project.id, 'Site B');
    await assignUserToProject(company.id, project.id, sup.id, siteA.id);

    const workerA = await createTestWorker(company.id, { firstName: 'WorkerA' });
    const workerB = await createTestWorker(company.id, { firstName: 'WorkerB' });
    await assignWorkerToSite(company.id, project.id, siteA.id, workerA.id, admin.id);
    await assignWorkerToSite(company.id, project.id, siteB.id, workerB.id, admin.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workers',
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const names = res.json().workers.map((w: { firstName: string }) => w.firstName);
    expect(names).toContain('WorkerA');
    expect(names).not.toContain('WorkerB');
  });

  it('filters by search query', async () => {
    const { company, admin } = await createTestCompany(app, 'wk-list-4');
    await createTestWorker(company.id, { firstName: 'James', lastName: 'Waweru' });
    await createTestWorker(company.id, { firstName: 'Peter', lastName: 'Kamau' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workers?search=Waweru',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().workers).toHaveLength(1);
    expect(res.json().workers[0].lastName).toBe('Waweru');
  });

  it('filters by isActive=false', async () => {
    const { company, admin } = await createTestCompany(app, 'wk-list-5');
    await createTestWorker(company.id, { firstName: 'Active' });
    await createTestWorker(company.id, { firstName: 'Inactive', isActive: false });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workers?isActive=false',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().workers).toHaveLength(1);
    expect(res.json().workers[0].firstName).toBe('Inactive');
  });

  it('filters by trade', async () => {
    const { company, admin } = await createTestCompany(app, 'wk-list-6');
    await createTestWorker(company.id, { trade: 'Mason' });
    await createTestWorker(company.id, { trade: 'Carpenter' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workers?trade=Mason',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().workers).toHaveLength(1);
    expect(res.json().workers[0].trade).toBe('Mason');
  });
});

// ─── GET /workers/:workerId ───────────────────────────────────────────────────

describe('GET /workers/:workerId', () => {
  it('returns worker with assignment details', async () => {
    const { company, admin } = await createTestCompany(app, 'wk-get-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id, { firstName: 'Detail' });
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${worker.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { worker: w } = res.json();
    expect(w.firstName).toBe('Detail');
    expect(w.assignments).toHaveLength(1);
    expect(w.assignments[0].site.name).toBeDefined();
  });

  it('returns 404 for non-existent worker', async () => {
    const { admin } = await createTestCompany(app, 'wk-get-2');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workers/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for worker in another company', async () => {
    const { admin: a1 } = await createTestCompany(app, 'wk-get-3a');
    const { company: c2 } = await createTestCompany(app, 'wk-get-3b');
    const worker = await createTestWorker(c2.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/workers/${worker.id}`,
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH /workers/:workerId ─────────────────────────────────────────────────

describe('PATCH /workers/:workerId', () => {
  it('company_admin can update worker details', async () => {
    const { company, admin } = await createTestCompany(app, 'wk-update-1');
    const worker = await createTestWorker(company.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${worker.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { trade: 'Electrician', dailyWage: 2500 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().worker.trade).toBe('Electrician');
    expect(res.json().worker.dailyWage).toBe('2500');
  });

  it('updating employmentStatus to suspended sets isActive false', async () => {
    const { company, admin } = await createTestCompany(app, 'wk-update-2');
    const worker = await createTestWorker(company.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${worker.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { employmentStatus: 'suspended' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().worker.employmentStatus).toBe('suspended');
    expect(res.json().worker.isActive).toBe(false);
  });

  it('site_supervisor cannot update a worker — 403', async () => {
    const { company } = await createTestCompany(app, 'wk-update-3');
    const sup    = await createTestUser(app, company.id, 'site_supervisor', 'sup-wu3');
    const worker = await createTestWorker(company.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${worker.id}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { trade: 'X' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on update', async () => {
    const { company, admin } = await createTestCompany(app, 'wk-update-audit');
    const worker = await createTestWorker(company.id);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/workers/${worker.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { notes: 'Updated notes' },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'update', entityType: 'worker', entityId: worker.id },
    });
    expect(log).toBeTruthy();
  });
});

// ─── DELETE /workers/:workerId ────────────────────────────────────────────────

describe('DELETE /workers/:workerId', () => {
  it('company_admin can deactivate a worker', async () => {
    const { company, admin } = await createTestCompany(app, 'wk-delete-1');
    const worker = await createTestWorker(company.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workers/${worker.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);

    const check = await prisma.worker.findUnique({ where: { id: worker.id } });
    expect(check?.isActive).toBe(false);
    expect(check?.employmentStatus).toBe('inactive');
  });

  it('project_manager cannot deactivate a worker — 403', async () => {
    const { company } = await createTestCompany(app, 'wk-delete-2');
    const pm     = await createTestUser(app, company.id, 'project_manager', 'pm-wd2');
    const worker = await createTestWorker(company.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/workers/${worker.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on deactivation', async () => {
    const { company, admin } = await createTestCompany(app, 'wk-delete-audit');
    const worker = await createTestWorker(company.id);

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/workers/${worker.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'delete', entityType: 'worker', entityId: worker.id },
    });
    expect(log).toBeTruthy();
  });
});

// ─── Site worker assignments ──────────────────────────────────────────────────

describe('POST /projects/:projectId/sites/:siteId/workers', () => {
  it('company_admin can assign a worker to a site', async () => {
    const { company, admin } = await createTestCompany(app, 'wa-assign-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sites/${site.id}/workers`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { workerId: worker.id },
    });

    expect(res.statusCode).toBe(201);

    const check = await prisma.workerAssignment.findFirst({
      where: { workerId: worker.id, siteId: site.id, removedAt: null },
    });
    expect(check).toBeTruthy();
  });

  it('cannot assign worker from another company — 404', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'wa-assign-2a');
    const { company: c2 }            = await createTestCompany(app, 'wa-assign-2b');
    const project  = await createTestProject(c1.id);
    const site     = await createTestSite(c1.id, project.id);
    const worker   = await createTestWorker(c2.id); // different company

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sites/${site.id}/workers`,
      headers: { authorization: `Bearer ${a1.accessToken}` },
      payload: { workerId: worker.id },
    });

    expect(res.statusCode).toBe(404);
  });

  it('double-assign same worker returns 422', async () => {
    const { company, admin } = await createTestCompany(app, 'wa-assign-3');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sites/${site.id}/workers`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { workerId: worker.id },
    });

    expect(res.statusCode).toBe(422);
  });

  it('site_supervisor cannot assign workers — 403', async () => {
    const { company } = await createTestCompany(app, 'wa-assign-4');
    const sup     = await createTestUser(app, company.id, 'site_supervisor', 'sup-wa4');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const worker  = await createTestWorker(company.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sites/${site.id}/workers`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { workerId: worker.id },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('DELETE /projects/:projectId/sites/:siteId/workers/:workerId', () => {
  it('company_admin can remove a worker assignment', async () => {
    const { company, admin } = await createTestCompany(app, 'wa-remove-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}/sites/${site.id}/workers/${worker.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);

    const check = await prisma.workerAssignment.findFirst({
      where: { workerId: worker.id, siteId: site.id, removedAt: null },
    });
    expect(check).toBeNull();
  });
});

describe('GET /projects/:projectId/sites/:siteId/workers', () => {
  it('lists only workers assigned to that site', async () => {
    const { company, admin } = await createTestCompany(app, 'wa-list-1');
    const project = await createTestProject(company.id);
    const siteA   = await createTestSite(company.id, project.id, 'Site A');
    const siteB   = await createTestSite(company.id, project.id, 'Site B');
    const wA      = await createTestWorker(company.id, { firstName: 'SiteA' });
    const wB      = await createTestWorker(company.id, { firstName: 'SiteB' });
    await assignWorkerToSite(company.id, project.id, siteA.id, wA.id, admin.id);
    await assignWorkerToSite(company.id, project.id, siteB.id, wB.id, admin.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/sites/${siteA.id}/workers`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().workers).toHaveLength(1);
    expect(res.json().workers[0].firstName).toBe('SiteA');
  });
});
