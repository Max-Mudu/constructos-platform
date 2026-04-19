import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
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

// ─── POST /api/v1/projects ────────────────────────────────────────────────────

describe('POST /api/v1/projects', () => {
  it('company_admin can create a project', async () => {
    const { admin } = await createTestCompany(app, 'proj-create-1');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Nairobi Tower', code: 'NT-001', location: 'Nairobi' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.project.name).toBe('Nairobi Tower');
    expect(body.project.code).toBe('NT-001');
    expect(body.project.companyId).toBe(admin.companyId);
  });

  it('project_manager cannot create a project — 403', async () => {
    const { company } = await createTestCompany(app, 'proj-create-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-c2');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { name: 'Should Fail' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('contractor cannot create a project — 403', async () => {
    const { company } = await createTestCompany(app, 'proj-create-3');
    const contractor = await createTestUser(app, company.id, 'contractor', 'c-c3');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${contractor.accessToken}` },
      payload: { name: 'Should Fail' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects missing name with 422', async () => {
    const { admin } = await createTestCompany(app, 'proj-create-4');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { code: 'NO-NAME' },
    });

    expect(res.statusCode).toBe(422);
  });

  it('writes audit log on project creation', async () => {
    const { admin } = await createTestCompany(app, 'proj-create-audit');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Audit Project' },
    });

    const projectId = res.json().project.id;
    const log = await prisma.auditLog.findFirst({
      where: { action: 'create', entityType: 'project', entityId: projectId },
    });
    expect(log).toBeTruthy();
  });
});

// ─── GET /api/v1/projects ─────────────────────────────────────────────────────

describe('GET /api/v1/projects', () => {
  it('company_admin sees all projects in their company', async () => {
    const { company, admin } = await createTestCompany(app, 'proj-list-1');
    await createTestProject(company.id, 'Project A');
    await createTestProject(company.id, 'Project B');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toHaveLength(2);
  });

  it('project_manager sees only assigned projects', async () => {
    const { company } = await createTestCompany(app, 'proj-list-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-list-2');
    const p1 = await createTestProject(company.id, 'Assigned Project');
    await createTestProject(company.id, 'Not Assigned');

    await assignUserToProject(company.id, p1.id, pm.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const projects = res.json().projects;
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe(p1.id);
  });

  it('contractor sees only assigned projects', async () => {
    const { company } = await createTestCompany(app, 'proj-list-3');
    const contractor = await createTestUser(app, company.id, 'contractor', 'c-list-3');
    const p1 = await createTestProject(company.id, 'Assigned');
    await createTestProject(company.id, 'Unassigned');

    await assignUserToProject(company.id, p1.id, contractor.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${contractor.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const projects = res.json().projects;
    expect(projects).toHaveLength(1);
    expect(projects[0].id).toBe(p1.id);
  });

  it('consultant sees only assigned projects', async () => {
    const { company } = await createTestCompany(app, 'proj-list-4');
    const consultant = await createTestUser(app, company.id, 'consultant', 'con-list-4');
    const p1 = await createTestProject(company.id, 'Assigned');
    await createTestProject(company.id, 'Unassigned');

    await assignUserToProject(company.id, p1.id, consultant.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${consultant.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toHaveLength(1);
  });

  it('company_admin from company A cannot see company B projects', async () => {
    const { admin: adminA } = await createTestCompany(app, 'proj-tenant-a');
    const { company: companyB } = await createTestCompany(app, 'proj-tenant-b');
    await createTestProject(companyB.id, 'Company B Project');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${adminA.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().projects).toHaveLength(0);
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/projects' });
    expect(res.statusCode).toBe(401);
  });
});

// ─── GET /api/v1/projects/:projectId ─────────────────────────────────────────

describe('GET /api/v1/projects/:projectId', () => {
  it('company_admin can get any project in their company', async () => {
    const { company, admin } = await createTestCompany(app, 'proj-get-1');
    const project = await createTestProject(company.id, 'Get Project');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().project.id).toBe(project.id);
  });

  it('project_manager with assignment can get project', async () => {
    const { company } = await createTestCompany(app, 'proj-get-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-get-2');
    const project = await createTestProject(company.id, 'PM Project');
    await assignUserToProject(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().project.id).toBe(project.id);
  });

  it('project_manager WITHOUT assignment gets 403', async () => {
    const { company } = await createTestCompany(app, 'proj-get-3');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-get-3');
    const project = await createTestProject(company.id, 'Unassigned Project');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('logs permission_denied to audit log when PM lacks access', async () => {
    const { company } = await createTestCompany(app, 'proj-get-audit');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-audit');
    const project = await createTestProject(company.id, 'Private Project');

    await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'permission_denied', entityType: 'project', entityId: project.id },
    });
    expect(log).toBeTruthy();
    expect(log!.userId).toBe(pm.id);
  });

  it('company A admin cannot get company B project — 404', async () => {
    const { admin: adminA } = await createTestCompany(app, 'proj-cross-a');
    const { company: companyB } = await createTestCompany(app, 'proj-cross-b');
    const projectB = await createTestProject(companyB.id, 'B Project');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectB.id}`,
      headers: { authorization: `Bearer ${adminA.accessToken}` },
    });

    // 404 not 403 — don't reveal the project exists in another tenant
    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH /api/v1/projects/:projectId ───────────────────────────────────────

describe('PATCH /api/v1/projects/:projectId', () => {
  it('company_admin can update project', async () => {
    const { company, admin } = await createTestCompany(app, 'proj-patch-1');
    const project = await createTestProject(company.id, 'Old Name');

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'New Name', status: 'active' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().project.name).toBe('New Name');
    expect(res.json().project.status).toBe('active');
  });

  it('project_manager cannot update project — 403', async () => {
    const { company } = await createTestCompany(app, 'proj-patch-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-patch-2');
    const project = await createTestProject(company.id, 'Some Project');
    await assignUserToProject(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { name: 'PM Should Not Update' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log with before/after values on update', async () => {
    const { company, admin } = await createTestCompany(app, 'proj-patch-audit');
    const project = await createTestProject(company.id, 'Before Name');

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'After Name' },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'update', entityType: 'project', entityId: project.id },
    });
    expect(log).toBeTruthy();
    expect((log!.changesBefore as Record<string, unknown>)['name']).toBe('Before Name');
    expect((log!.changesAfter as Record<string, unknown>)['name']).toBe('After Name');
  });
});

// ─── DELETE /api/v1/projects/:projectId ──────────────────────────────────────

describe('DELETE /api/v1/projects/:projectId', () => {
  it('company_admin can archive a project', async () => {
    const { company, admin } = await createTestCompany(app, 'proj-del-1');
    const project = await createTestProject(company.id, 'To Archive');

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().project.status).toBe('archived');
  });

  it('archived project does not appear in list', async () => {
    const { company, admin } = await createTestCompany(app, 'proj-del-2');
    const project = await createTestProject(company.id, 'Will Be Archived');

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(listRes.json().projects).toHaveLength(0);
  });

  it('contractor cannot delete project — 403', async () => {
    const { company } = await createTestCompany(app, 'proj-del-3');
    const contractor = await createTestUser(app, company.id, 'contractor', 'c-del-3');
    const project = await createTestProject(company.id, 'Protected');
    await assignUserToProject(company.id, project.id, contractor.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${contractor.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });
});
