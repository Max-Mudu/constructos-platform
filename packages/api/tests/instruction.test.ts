import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestContractor,
  assignUserToProject,
  createTestInstruction,
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

// ─── GET /instructions ────────────────────────────────────────────────────────

describe('GET /projects/:projectId/instructions', () => {
  it('project_manager can list instructions', async () => {
    const { company } = await createTestCompany(app, 'instr-list-1');
    const pm = await createTestUser(app, company.id, 'project_manager', 'instr-list-1-pm');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    await createTestInstruction(company.id, project.id, pm.id, { title: 'Instruction 1' });
    await createTestInstruction(company.id, project.id, pm.id, { title: 'Instruction 2', type: 'recommendation' });

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/projects/${project.id}/instructions`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().instructions).toHaveLength(2);
  });

  it('filters by status', async () => {
    const { company, admin } = await createTestCompany(app, 'instr-list-2');
    const project = await createTestProject(company.id);
    await createTestInstruction(company.id, project.id, admin.id, { status: 'open' });
    await createTestInstruction(company.id, project.id, admin.id, { status: 'resolved' });

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/projects/${project.id}/instructions?status=open`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().instructions).toHaveLength(1);
    expect(res.json().instructions[0].status).toBe('open');
  });

  it('contractor sees only their assigned instructions', async () => {
    const { company } = await createTestCompany(app, 'instr-list-3');
    const pm = await createTestUser(app, company.id, 'project_manager', 'instr-list-3-pm');
    const contractorUser = await createTestUser(app, company.id, 'contractor', 'instr-list-3-c');
    const contractorRecord = await createTestContractor(company.id, 'List-3 Contractor', contractorUser.id);
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    await assignUserToProject(company.id, project.id, contractorUser.id);

    // One directed at their contractor, one not
    await createTestInstruction(company.id, project.id, pm.id, { contractorId: contractorRecord.id });
    await createTestInstruction(company.id, project.id, pm.id); // no contractor

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/projects/${project.id}/instructions`,
      headers: { authorization: `Bearer ${contractorUser.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().instructions).toHaveLength(1);
  });
});

// ─── POST /instructions ───────────────────────────────────────────────────────

describe('POST /projects/:projectId/instructions', () => {
  it('consultant can create an instruction', async () => {
    const { company } = await createTestCompany(app, 'instr-create-1');
    const consultant = await createTestUser(app, company.id, 'consultant', 'instr-create-1-c');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, consultant.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/projects/${project.id}/instructions`,
      headers: { authorization: `Bearer ${consultant.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        type:        'instruction',
        title:       'Fix north elevation crack',
        category:    'Structural',
        priority:    'high',
        description: 'Crack observed at north elevation column C3',
        issuedDate:  '2026-04-09',
        targetActionDate: '2026-04-15',
      }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().instruction.title).toBe('Fix north elevation crack');
    expect(res.json().instruction.priority).toBe('high');
    expect(res.json().instruction.status).toBe('open');
    expect(res.json().instruction.issuedById).toBe(consultant.id);
  });

  it('contractor cannot create instructions', async () => {
    const { company } = await createTestCompany(app, 'instr-create-2');
    const contractorUser = await createTestUser(app, company.id, 'contractor', 'instr-create-2-c');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, contractorUser.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/projects/${project.id}/instructions`,
      headers: { authorization: `Bearer ${contractorUser.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'instruction', title: 'Hack', issuedDate: '2026-04-09' }),
    });

    expect(res.statusCode).toBe(403);
  });

  it('validates required fields', async () => {
    const { company, admin } = await createTestCompany(app, 'instr-create-3');
    const project = await createTestProject(company.id);

    const res = await app.inject({
      method: 'POST',
      url:    `/api/v1/projects/${project.id}/instructions`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Missing required fields' }),
    });

    expect(res.statusCode).toBe(422);
  });
});

// ─── GET /instructions/:instructionId ─────────────────────────────────────────

describe('GET /projects/:projectId/instructions/:instructionId', () => {
  it('returns instruction detail', async () => {
    const { company, admin } = await createTestCompany(app, 'instr-get-1');
    const project = await createTestProject(company.id);
    const instr = await createTestInstruction(company.id, project.id, admin.id, { title: 'My Instruction' });

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/projects/${project.id}/instructions/${instr.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().instruction.title).toBe('My Instruction');
    expect(res.json().instruction.attachments).toBeDefined();
  });

  it('returns 404 for non-existent instruction', async () => {
    const { company, admin } = await createTestCompany(app, 'instr-get-2');
    const project = await createTestProject(company.id);

    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/projects/${project.id}/instructions/non-existent-uuid-here`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH /instructions/:instructionId ───────────────────────────────────────

describe('PATCH /projects/:projectId/instructions/:instructionId', () => {
  it('project_manager can update status and resolution notes', async () => {
    const { company } = await createTestCompany(app, 'instr-update-1');
    const pm = await createTestUser(app, company.id, 'project_manager', 'instr-update-1-pm');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    const instr = await createTestInstruction(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'PATCH',
      url:    `/api/v1/projects/${project.id}/instructions/${instr.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved', resolutionNotes: 'Fixed on site' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().instruction.status).toBe('resolved');
    expect(res.json().instruction.resolutionNotes).toBe('Fixed on site');
  });

  it('contractor can only update their response', async () => {
    const { company } = await createTestCompany(app, 'instr-update-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'instr-update-2-pm');
    const contractorUser = await createTestUser(app, company.id, 'contractor', 'instr-update-2-c');
    const contractorRecord = await createTestContractor(company.id, 'Upd-2 Contractor', contractorUser.id);
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    await assignUserToProject(company.id, project.id, contractorUser.id);

    const instr = await createTestInstruction(company.id, project.id, pm.id, {
      contractorId: contractorRecord.id,
    });

    // Contractor sets their response
    const res = await app.inject({
      method: 'PATCH',
      url:    `/api/v1/projects/${project.id}/instructions/${instr.id}`,
      headers: { authorization: `Bearer ${contractorUser.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ contractorResponse: 'We acknowledge this instruction' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().instruction.contractorResponse).toBe('We acknowledge this instruction');
  });

  it('contractor cannot change status (forbidden field)', async () => {
    const { company } = await createTestCompany(app, 'instr-update-3');
    const pm = await createTestUser(app, company.id, 'project_manager', 'instr-update-3-pm');
    const contractorUser = await createTestUser(app, company.id, 'contractor', 'instr-update-3-c');
    const contractorRecord = await createTestContractor(company.id, 'Upd-3 Contractor', contractorUser.id);
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, pm.id);
    await assignUserToProject(company.id, project.id, contractorUser.id);
    const instr = await createTestInstruction(company.id, project.id, pm.id, {
      contractorId: contractorRecord.id,
    });

    const res = await app.inject({
      method: 'PATCH',
      url:    `/api/v1/projects/${project.id}/instructions/${instr.id}`,
      headers: { authorization: `Bearer ${contractorUser.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });

    expect(res.statusCode).toBe(403);
  });

  it('site_supervisor can only update status', async () => {
    const { company } = await createTestCompany(app, 'instr-update-4');
    const pm = await createTestUser(app, company.id, 'project_manager', 'instr-update-4-pm');
    const supervisor = await createTestUser(app, company.id, 'site_supervisor', 'instr-update-4-s');
    const project = await createTestProject(company.id);
    const site = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, pm.id);
    await assignUserToProject(company.id, project.id, supervisor.id, site.id);
    const instr = await createTestInstruction(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'PATCH',
      url:    `/api/v1/projects/${project.id}/instructions/${instr.id}`,
      headers: { authorization: `Bearer ${supervisor.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'acknowledged' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().instruction.status).toBe('acknowledged');
  });

  it('consultant can only update their own instructions', async () => {
    const { company } = await createTestCompany(app, 'instr-update-5');
    const consultant1 = await createTestUser(app, company.id, 'consultant', 'instr-update-5-c1');
    const consultant2 = await createTestUser(app, company.id, 'consultant', 'instr-update-5-c2');
    const project = await createTestProject(company.id);
    await assignUserToProject(company.id, project.id, consultant1.id);
    await assignUserToProject(company.id, project.id, consultant2.id);

    // consultant1 creates an instruction
    const instr = await createTestInstruction(company.id, project.id, consultant1.id);

    // consultant2 tries to update it
    const res = await app.inject({
      method: 'PATCH',
      url:    `/api/v1/projects/${project.id}/instructions/${instr.id}`,
      headers: { authorization: `Bearer ${consultant2.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Hijacked title' }),
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── Audit logging ────────────────────────────────────────────────────────────

describe('Instruction audit logging', () => {
  it('creates audit log on instruction creation', async () => {
    const { company, admin } = await createTestCompany(app, 'instr-audit-1');
    const project = await createTestProject(company.id);

    await app.inject({
      method: 'POST',
      url:    `/api/v1/projects/${project.id}/instructions`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'recommendation', title: 'Audit test', issuedDate: '2026-04-09',
      }),
    });

    const log = await prisma.auditLog.findFirst({
      where: { companyId: company.id, entityType: 'consultant_instruction', action: 'create' },
    });
    expect(log).not.toBeNull();
  });

  it('creates audit log on status update', async () => {
    const { company, admin } = await createTestCompany(app, 'instr-audit-2');
    const project = await createTestProject(company.id);
    const instr = await createTestInstruction(company.id, project.id, admin.id);

    await app.inject({
      method: 'PATCH',
      url:    `/api/v1/projects/${project.id}/instructions/${instr.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });

    const log = await prisma.auditLog.findFirst({
      where: { companyId: company.id, entityType: 'consultant_instruction', action: 'update' },
    });
    expect(log).not.toBeNull();
  });
});
