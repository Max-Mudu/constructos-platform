import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
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

// ─── POST /api/v1/projects/:projectId/sites ───────────────────────────────────

describe('POST /api/v1/projects/:projectId/sites', () => {
  it('company_admin can create a site', async () => {
    const { company, admin } = await createTestCompany(app, 'site-create-1');
    const project = await createTestProject(company.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sites`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Block A', address: '123 Main St', latitude: -1.28, longitude: 36.82 },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.site.name).toBe('Block A');
    expect(body.site.projectId).toBe(project.id);
    expect(body.site.companyId).toBe(company.id);
  });

  it('project_manager assigned to project can create a site', async () => {
    const { company } = await createTestCompany(app, 'site-create-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-sc2');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sites`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { name: 'PM Site' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().site.name).toBe('PM Site');
  });

  it('project_manager NOT assigned to project gets 403', async () => {
    const { company } = await createTestCompany(app, 'site-create-3');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-sc3');
    const project = await createTestProject(company.id);
    // no assignment

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sites`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { name: 'Should Fail' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('site_supervisor cannot create a site — 403', async () => {
    const { company } = await createTestCompany(app, 'site-create-4');
    const sup = await createTestUser(app, company.id, 'site_supervisor', 'sup-sc4');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, sup.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sites`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { name: 'Should Fail' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('contractor cannot create a site — 403', async () => {
    const { company } = await createTestCompany(app, 'site-create-5');
    const contractor = await createTestUser(app, company.id, 'contractor', 'c-sc5');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, contractor.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sites`,
      headers: { authorization: `Bearer ${contractor.accessToken}` },
      payload: { name: 'Should Fail' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on site creation', async () => {
    const { company, admin } = await createTestCompany(app, 'site-create-audit');
    const project = await createTestProject(company.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sites`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Audit Site' },
    });

    const siteId = res.json().site.id;
    const log = await prisma.auditLog.findFirst({
      where: { action: 'create', entityType: 'job_site', entityId: siteId },
    });
    expect(log).toBeTruthy();
  });
});

// ─── GET /api/v1/projects/:projectId/sites ───────────────────────────────────

describe('GET /api/v1/projects/:projectId/sites', () => {
  it('company_admin sees all sites in project', async () => {
    const { company, admin } = await createTestCompany(app, 'site-list-1');
    const project = await createTestProject(company.id);
    await createTestSite(company.id, project.id, 'Site A');
    await createTestSite(company.id, project.id, 'Site B');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/sites`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().sites).toHaveLength(2);
  });

  it('site_supervisor with site assignment sees only their site', async () => {
    const { company } = await createTestCompany(app, 'site-list-2');
    const project = await createTestProject(company.id);
    const site1 = await createTestSite(company.id, project.id, 'Site 1');
    await createTestSite(company.id, project.id, 'Site 2');

    const sup = await createTestUser(app, company.id, 'site_supervisor', 'sup-sl2');
    // Assign supervisor specifically to site1
    await assignUserToProject(company.id, project.id, sup.id, site1.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/sites`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const sites = res.json().sites;
    expect(sites).toHaveLength(1);
    expect(sites[0].id).toBe(site1.id);
  });

  it('site_supervisor with open project assignment (no siteId) sees all sites', async () => {
    const { company } = await createTestCompany(app, 'site-list-3');
    const project = await createTestProject(company.id);
    await createTestSite(company.id, project.id, 'Site X');
    await createTestSite(company.id, project.id, 'Site Y');

    const sup = await createTestUser(app, company.id, 'site_supervisor', 'sup-sl3');
    await assignUserToProject(company.id, project.id, sup.id); // no siteId

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/sites`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().sites).toHaveLength(2);
  });

  it('contractor sees all sites in assigned project', async () => {
    const { company } = await createTestCompany(app, 'site-list-4');
    const project = await createTestProject(company.id);
    await createTestSite(company.id, project.id, 'Site 1');
    await createTestSite(company.id, project.id, 'Site 2');
    const contractor = await createTestUser(app, company.id, 'contractor', 'c-sl4');
    await assignUserToProject(company.id, project.id, contractor.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/sites`,
      headers: { authorization: `Bearer ${contractor.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().sites).toHaveLength(2);
  });

  it('unassigned user gets 403', async () => {
    const { company } = await createTestCompany(app, 'site-list-5');
    const project = await createTestProject(company.id);
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-sl5');
    // not assigned

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/sites`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('cross-tenant: admin A cannot list sites of company B project', async () => {
    const { admin: adminA } = await createTestCompany(app, 'site-cross-a');
    const { company: companyB } = await createTestCompany(app, 'site-cross-b');
    const projectB = await createTestProject(companyB.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectB.id}/sites`,
      headers: { authorization: `Bearer ${adminA.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /api/v1/projects/:projectId/sites/:siteId ───────────────────────────

describe('GET /api/v1/projects/:projectId/sites/:siteId', () => {
  it('company_admin can get a specific site', async () => {
    const { company, admin } = await createTestCompany(app, 'site-get-1');
    const project = await createTestProject(company.id);
    const site = await createTestSite(company.id, project.id, 'Specific Site');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/sites/${site.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().site.id).toBe(site.id);
  });

  it('site_supervisor with different site assignment cannot access this site — 404', async () => {
    const { company } = await createTestCompany(app, 'site-get-2');
    const project = await createTestProject(company.id);
    const site1 = await createTestSite(company.id, project.id, 'Site 1');
    const site2 = await createTestSite(company.id, project.id, 'Site 2');

    const sup = await createTestUser(app, company.id, 'site_supervisor', 'sup-sg2');
    await assignUserToProject(company.id, project.id, sup.id, site1.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/sites/${site2.id}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH /api/v1/projects/:projectId/sites/:siteId ─────────────────────────

describe('PATCH /api/v1/projects/:projectId/sites/:siteId', () => {
  it('company_admin can update a site', async () => {
    const { company, admin } = await createTestCompany(app, 'site-patch-1');
    const project = await createTestProject(company.id);
    const site = await createTestSite(company.id, project.id, 'Old Site Name');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${project.id}/sites/${site.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'New Site Name', address: '456 Updated Ave' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().site.name).toBe('New Site Name');
  });

  it('project_manager assigned to project can update site', async () => {
    const { company } = await createTestCompany(app, 'site-patch-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-sp2');
    const project = await createTestProject(company.id);
    const site = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${project.id}/sites/${site.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { name: 'PM Updated Site' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().site.name).toBe('PM Updated Site');
  });

  it('writes audit log with before/after on site update', async () => {
    const { company, admin } = await createTestCompany(app, 'site-patch-audit');
    const project = await createTestProject(company.id);
    const site = await createTestSite(company.id, project.id, 'Before');

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${project.id}/sites/${site.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'After' },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'update', entityType: 'job_site', entityId: site.id },
    });
    expect(log).toBeTruthy();
    expect((log!.changesBefore as Record<string, unknown>)['name']).toBe('Before');
    expect((log!.changesAfter as Record<string, unknown>)['name']).toBe('After');
  });

  it('site_supervisor cannot update site — 403', async () => {
    const { company } = await createTestCompany(app, 'site-patch-3');
    const sup = await createTestUser(app, company.id, 'site_supervisor', 'sup-sp3');
    const project = await createTestProject(company.id);
    const site = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${project.id}/sites/${site.id}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { name: 'Should Fail' },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── DELETE /api/v1/projects/:projectId/sites/:siteId ────────────────────────

describe('DELETE /api/v1/projects/:projectId/sites/:siteId', () => {
  it('company_admin can deactivate a site', async () => {
    const { company, admin } = await createTestCompany(app, 'site-del-1');
    const project = await createTestProject(company.id);
    const site = await createTestSite(company.id, project.id, 'To Deactivate');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}/sites/${site.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().site.isActive).toBe(false);
  });

  it('project_manager cannot deactivate site — 403', async () => {
    const { company } = await createTestCompany(app, 'site-del-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-sd2');
    const project = await createTestProject(company.id);
    const site = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}/sites/${site.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });
});
