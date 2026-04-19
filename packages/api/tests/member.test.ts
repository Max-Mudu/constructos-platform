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

// ─── POST /api/v1/projects/:projectId/members ─────────────────────────────────

describe('POST /api/v1/projects/:projectId/members', () => {
  it('company_admin can add a project_manager to a project', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-add-1');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-add-1');
    const project = await createTestProject(company.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { userId: pm.id },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.member.userId).toBe(pm.id);
    expect(body.member.projectId).toBe(project.id);
    expect(body.member.siteId).toBeNull();
    expect(body.member.user.email).toBe(pm.email);
  });

  it('company_admin can add site_supervisor scoped to a specific site', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-add-2');
    const sup = await createTestUser(app, company.id, 'site_supervisor', 'sup-add-2');
    const project = await createTestProject(company.id);
    const site = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { userId: sup.id, siteId: site.id },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().member.siteId).toBe(site.id);
  });

  it('rejects adding with a siteId that does not belong to the project — 404', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-add-3');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-add-3');
    const project = await createTestProject(company.id);
    const otherProject = await createTestProject(company.id, 'Other');
    const wrongSite = await createTestSite(company.id, otherProject.id, 'Wrong Site');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { userId: pm.id, siteId: wrongSite.id },
    });

    expect(res.statusCode).toBe(404);
  });

  it('rejects adding same user twice — 409', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-add-4');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-add-4');
    const project = await createTestProject(company.id);

    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { userId: pm.id },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { userId: pm.id },
    });

    expect(res.statusCode).toBe(409);
  });

  it('rejects adding company_admin as member — 422', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-add-5');
    const project = await createTestProject(company.id);
    const anotherAdmin = await createTestUser(app, company.id, 'company_admin', 'admin2-add-5');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { userId: anotherAdmin.id },
    });

    expect(res.statusCode).toBe(422);
  });

  it('rejects adding user from another company — 404', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-cross-1');
    const { company: companyB } = await createTestCompany(app, 'mem-cross-2');
    const foreignUser = await createTestUser(app, companyB.id, 'project_manager', 'pm-cross');
    const project = await createTestProject(company.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { userId: foreignUser.id },
    });

    expect(res.statusCode).toBe(404);
  });

  it('project_manager cannot add members — 403', async () => {
    const { company } = await createTestCompany(app, 'mem-add-6');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-add-6');
    const target = await createTestUser(app, company.id, 'contractor', 'c-add-6');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { userId: target.id },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on member addition', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-add-audit');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-audit');
    const project = await createTestProject(company.id);

    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { userId: pm.id },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'create', entityType: 'project_member', userId: admin.id },
    });
    expect(log).toBeTruthy();
    expect((log!.changesAfter as Record<string, unknown>)['addedUserId']).toBe(pm.id);
  });
});

// ─── GET /api/v1/projects/:projectId/members ──────────────────────────────────

describe('GET /api/v1/projects/:projectId/members', () => {
  it('company_admin can list all project members', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-list-1');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-list-1');
    const contractor = await createTestUser(app, company.id, 'contractor', 'c-list-1');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    await assignUserToProject(company.id, project.id, contractor.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().members).toHaveLength(2);
  });

  it('project_manager can list members of their own project', async () => {
    const { company } = await createTestCompany(app, 'mem-list-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-list-2');
    const contractor = await createTestUser(app, company.id, 'contractor', 'c-list-2');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    await assignUserToProject(company.id, project.id, contractor.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().members).toHaveLength(2);
  });

  it('contractor cannot list project members — 403', async () => {
    const { company } = await createTestCompany(app, 'mem-list-3');
    const contractor = await createTestUser(app, company.id, 'contractor', 'c-list-3');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, contractor.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${contractor.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('returned members do not include password hashes', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-list-safe');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-safe');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const members = res.json().members;
    for (const m of members) {
      expect(m.user.passwordHash).toBeUndefined();
    }
  });
});

// ─── DELETE /api/v1/projects/:projectId/members/:userId ──────────────────────

describe('DELETE /api/v1/projects/:projectId/members/:userId', () => {
  it('company_admin can remove a member', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-del-1');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-del-1');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}/members/${pm.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);

    // Verify the membership is soft-removed (removedAt set)
    const membership = await prisma.projectMember.findFirst({
      where: { projectId: project.id, userId: pm.id },
    });
    expect(membership!.removedAt).not.toBeNull();
  });

  it('removed member no longer appears in member list', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-del-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-del-2');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}/members/${pm.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}/members`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(listRes.json().members).toHaveLength(0);
  });

  it('removed member loses project access', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-del-3');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-del-3');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);

    // Remove from project
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}/members/${pm.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    // PM tries to access project — should get 403
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${project.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on member removal', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-del-audit');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-del-audit');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}/members/${pm.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'delete', entityType: 'project_member' },
    });
    expect(log).toBeTruthy();
    expect((log!.changesBefore as Record<string, unknown>)['userId']).toBe(pm.id);
  });

  it('project_manager cannot remove members — 403', async () => {
    const { company } = await createTestCompany(app, 'mem-del-4');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-del-4');
    const contractor = await createTestUser(app, company.id, 'contractor', 'c-del-4');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    await assignUserToProject(company.id, project.id, contractor.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}/members/${contractor.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('removing non-member returns 404', async () => {
    const { company, admin } = await createTestCompany(app, 'mem-del-5');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-del-5');
    const project = await createTestProject(company.id);
    // pm never assigned

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${project.id}/members/${pm.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
