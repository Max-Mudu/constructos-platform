import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  assignUserToProject,
  createTestDrawing,
  createTestRevision,
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

// ─── GET /drawings — list ─────────────────────────────────────────────────────

describe('GET /projects/:projectId/drawings', () => {
  it('project_manager can list drawings', async () => {
    const { company, admin } = await createTestCompany(app, 'drw-list-1');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, admin.id);
    await createTestDrawing(company.id, project.id, admin.id, { drawingNumber: 'A-001', title: 'Floor Plan' });
    await createTestDrawing(company.id, project.id, admin.id, { drawingNumber: 'S-001', title: 'Structural' });

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/projects/${project.id}/drawings`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().drawings).toHaveLength(2);
  });

  it('returns 401 without auth', async () => {
    const { company } = await createTestCompany(app, 'drw-list-2');
    const project = await createTestProject(company.id);

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/projects/${project.id}/drawings`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('non-member cannot list drawings', async () => {
    const { company, admin } = await createTestCompany(app, 'drw-list-3');
    const project = await createTestProject(company.id);
    // Do NOT assign admin to project (they are company_admin so they bypass, let's use a pm)
    const pm = await createTestUser(app, company.id, 'project_manager', 'drw-list-3-pm');
    // pm is NOT assigned to project
    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/projects/${project.id}/drawings`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });
    // company_admin bypasses, pm gets 403
    expect(res.statusCode).toBe(403);
  });
});

// ─── POST /drawings — create ──────────────────────────────────────────────────

describe('POST /projects/:projectId/drawings', () => {
  it('project_manager can create a drawing', async () => {
    const { company } = await createTestCompany(app, 'drw-create-1');
    const pm = await createTestUser(app, company.id, 'project_manager', 'drw-create-1-pm');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/projects/${project.id}/drawings`,
      headers: { authorization: `Bearer ${pm.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ drawingNumber: 'A-001', title: 'Ground Floor Plan', discipline: 'Architectural' }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().drawing.drawingNumber).toBe('A-001');
    expect(res.json().drawing.title).toBe('Ground Floor Plan');
  });

  it('duplicate drawing number in same project is rejected', async () => {
    const { company, admin } = await createTestCompany(app, 'drw-create-2');
    const project = await createTestProject(company.id);
    await createTestDrawing(company.id, project.id, admin.id, { drawingNumber: 'A-001' });

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/projects/${project.id}/drawings`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ drawingNumber: 'A-001', title: 'Another Plan' }),
    });

    expect(res.statusCode).not.toBe(201);
  });

  it('contractor cannot create drawings', async () => {
    const { company } = await createTestCompany(app, 'drw-create-3');
    const contractor = await createTestUser(app, company.id, 'contractor', 'drw-create-3-c');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, contractor.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/projects/${project.id}/drawings`,
      headers: { authorization: `Bearer ${contractor.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ drawingNumber: 'X-001', title: 'Unauthorised' }),
    });

    expect(res.statusCode).toBe(403);
  });

  it('validates required fields', async () => {
    const { company, admin } = await createTestCompany(app, 'drw-create-4');
    const project = await createTestProject(company.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/projects/${project.id}/drawings`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Missing number' }),
    });

    expect(res.statusCode).toBe(422);
  });
});

// ─── GET /drawings/:drawingId ─────────────────────────────────────────────────

describe('GET /projects/:projectId/drawings/:drawingId', () => {
  it('returns drawing with revisions', async () => {
    const { company, admin } = await createTestCompany(app, 'drw-get-1');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, admin.id);
    const drawing = await createTestDrawing(company.id, project.id, admin.id);
    await createTestRevision(drawing.id, company.id, admin.id, { revisionNumber: 'A' });

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/projects/${project.id}/drawings/${drawing.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().drawing.revisions).toHaveLength(1);
    expect(res.json().drawing.revisions[0].revisionNumber).toBe('A');
  });

  it('returns 404 for non-existent drawing', async () => {
    const { company, admin } = await createTestCompany(app, 'drw-get-2');
    const project = await createTestProject(company.id);

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/projects/${project.id}/drawings/non-existent-id`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH /drawings/:drawingId ───────────────────────────────────────────────

describe('PATCH /projects/:projectId/drawings/:drawingId', () => {
  it('project_manager can update a drawing', async () => {
    const { company } = await createTestCompany(app, 'drw-update-1');
    const pm = await createTestUser(app, company.id, 'project_manager', 'drw-update-1-pm');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    const drawing = await createTestDrawing(company.id, project.id, pm.id, { title: 'Old Title' });

    const res = await app.inject({
      method: 'PATCH',
      url:    `/api/v1/projects/${project.id}/drawings/${drawing.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Title', discipline: 'MEP' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().drawing.title).toBe('Updated Title');
    expect(res.json().drawing.discipline).toBe('MEP');
  });

  it('site_supervisor cannot update drawings', async () => {
    const { company } = await createTestCompany(app, 'drw-update-2');
    const supervisor = await createTestUser(app, company.id, 'site_supervisor', 'drw-update-2-s');
    const project = await createTestProject(company.id);
    const site = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, supervisor.id, site.id);
    const pm = await createTestUser(app, company.id, 'project_manager', 'drw-update-2-pm');
    await assignUserToProject(company.id, project.id, pm.id);
    const drawing = await createTestDrawing(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'PATCH',
      url:    `/api/v1/projects/${project.id}/drawings/${drawing.id}`,
      headers: { authorization: `Bearer ${supervisor.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hacked' }),
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── DELETE /drawings/:drawingId ──────────────────────────────────────────────

describe('DELETE /projects/:projectId/drawings/:drawingId', () => {
  it('company_admin can delete a drawing', async () => {
    const { company, admin } = await createTestCompany(app, 'drw-del-1');
    const project = await createTestProject(company.id);
    const drawing = await createTestDrawing(company.id, project.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url:    `/api/v1/projects/${project.id}/drawings/${drawing.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);
  });

  it('consultant cannot delete drawings', async () => {
    const { company } = await createTestCompany(app, 'drw-del-2');
    const consultant = await createTestUser(app, company.id, 'consultant', 'drw-del-2-c');
    const pm = await createTestUser(app, company.id, 'project_manager', 'drw-del-2-pm');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, consultant.id);
    await assignUserToProject(company.id, project.id, pm.id);
    const drawing = await createTestDrawing(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'DELETE',
      url:    `/api/v1/projects/${project.id}/drawings/${drawing.id}`,
      headers: { authorization: `Bearer ${consultant.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── POST /revisions/:revisionId/approve ─────────────────────────────────────

describe('POST .../revisions/:revisionId/approve', () => {
  it('project_manager can approve a revision', async () => {
    const { company } = await createTestCompany(app, 'drw-approve-1');
    const pm = await createTestUser(app, company.id, 'project_manager', 'drw-approve-1-pm');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    const drawing = await createTestDrawing(company.id, project.id, pm.id);
    const revision = await createTestRevision(drawing.id, company.id, pm.id, { revisionNumber: 'A', status: 'draft' });

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/projects/${project.id}/drawings/${drawing.id}/revisions/${revision.id}/approve`,
      headers: { authorization: `Bearer ${pm.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().revision.status).toBe('issued_for_construction');
    expect(res.json().revision.approvedById).toBe(pm.id);
  });

  it('contractor cannot approve revisions', async () => {
    const { company } = await createTestCompany(app, 'drw-approve-2');
    const contractor = await createTestUser(app, company.id, 'contractor', 'drw-approve-2-c');
    const pm = await createTestUser(app, company.id, 'project_manager', 'drw-approve-2-pm');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, contractor.id);
    await assignUserToProject(company.id, project.id, pm.id);
    const drawing = await createTestDrawing(company.id, project.id, pm.id);
    const revision = await createTestRevision(drawing.id, company.id, pm.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/projects/${project.id}/drawings/${drawing.id}/revisions/${revision.id}/approve`,
      headers: { authorization: `Bearer ${contractor.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── Comments ─────────────────────────────────────────────────────────────────

describe('Drawing comments', () => {
  it('consultant can add a comment to a revision', async () => {
    const { company } = await createTestCompany(app, 'drw-comment-1');
    const pm = await createTestUser(app, company.id, 'project_manager', 'drw-comment-1-pm');
    const consultant = await createTestUser(app, company.id, 'consultant', 'drw-comment-1-c');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    await assignUserToProject(company.id, project.id, consultant.id);
    const drawing = await createTestDrawing(company.id, project.id, pm.id);
    const revision = await createTestRevision(drawing.id, company.id, pm.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/projects/${project.id}/drawings/${drawing.id}/revisions/${revision.id}/comments`,
      headers: { authorization: `Bearer ${consultant.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'Check column size at grid B2' }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().comment.text).toBe('Check column size at grid B2');
  });

  it('can list comments on a revision', async () => {
    const { company, admin } = await createTestCompany(app, 'drw-comment-2');
    const project = await createTestProject(company.id);
    const drawing = await createTestDrawing(company.id, project.id, admin.id);
    const revision = await createTestRevision(drawing.id, company.id, admin.id);

    await prisma.drawingComment.create({
      data: {
        companyId:  company.id,
        drawingId:  drawing.id,
        revisionId: revision.id,
        userId:     admin.id,
        text:       'Test comment',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/projects/${project.id}/drawings/${drawing.id}/revisions/${revision.id}/comments`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().comments).toHaveLength(1);
  });
});

// ─── Audit logging ────────────────────────────────────────────────────────────

describe('Drawing audit logging', () => {
  it('creates audit log on drawing creation', async () => {
    const { company, admin } = await createTestCompany(app, 'drw-audit-1');
    const project = await createTestProject(company.id);

    await app.inject({
      method: 'POST',
      url:    `/api/v1/projects/${project.id}/drawings`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ drawingNumber: 'AUDIT-001', title: 'Audit Test' }),
    });

    const log = await prisma.auditLog.findFirst({
      where: { companyId: company.id, entityType: 'drawing', action: 'create' },
    });
    expect(log).not.toBeNull();
    expect(log?.userEmail).toBe(admin.email);
  });
});
