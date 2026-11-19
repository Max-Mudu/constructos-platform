/**
 * POST /projects/:projectId/instructions/:instructionId/attachments
 *
 * Who may add a file to an instruction:
 *  - the consultant who issued it;
 *  - project managers on the project and company admins (any instruction);
 *  - not another consultant on the same project (same rule as editing the
 *    instruction), and no stored file or row is left behind by a refusal.
 * Project and company scope keep their existing answers (403 for a project the
 * caller is not a member of, 404 for another company), and reading the
 * instruction and its files is unchanged.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { MemoryStorageDriver } from '../src/services/storage/memory';
import {
  assignUserToProject, buildMultipartFile, clearDatabase, createTestCompany, createTestInstruction,
  createTestProject, createTestUser, TestUser,
} from './helpers/fixtures';

const memory = new MemoryStorageDriver();
let app: FastifyInstance;

interface World {
  admin: TestUser;
  issuer: TestUser;
  otherConsultant: TestUser;
  pm: TestUser;
  supervisor: TestUser;
  otherProjectConsultant: TestUser;
  foreignAdmin: TestUser;
  foreignConsultant: TestUser;
  projectId: string;
  foreignProjectId: string;
  instrByIssuer: string;
  instrByAdmin: string;
}
let w: World;

beforeAll(async () => {
  await clearDatabase();
  app = await buildApp({ uploadStorage: memory });
  await app.ready();

  const { company, admin } = await createTestCompany(app, 'instr-attach-access');
  const project = await createTestProject(company.id, 'Attach Project');
  const otherProject = await createTestProject(company.id, 'Other Project');
  const issuer = await createTestUser(app, company.id, 'consultant', 'iaa-issuer');
  const otherConsultant = await createTestUser(app, company.id, 'consultant', 'iaa-other');
  const pm = await createTestUser(app, company.id, 'project_manager', 'iaa-pm');
  const supervisor = await createTestUser(app, company.id, 'site_supervisor', 'iaa-sup');
  const otherProjectConsultant = await createTestUser(app, company.id, 'consultant', 'iaa-otherproj');
  for (const u of [issuer, otherConsultant, pm, supervisor]) {
    await assignUserToProject(company.id, project.id, u.id);
  }
  await assignUserToProject(company.id, otherProject.id, otherProjectConsultant.id);

  const foreign = await createTestCompany(app, 'instr-attach-foreign');
  const foreignProject = await createTestProject(foreign.company.id, 'Foreign Project');
  const foreignConsultant = await createTestUser(app, foreign.company.id, 'consultant', 'iaa-foreign');
  await assignUserToProject(foreign.company.id, foreignProject.id, foreignConsultant.id);

  const instrByIssuer = await createTestInstruction(company.id, project.id, issuer.id, { title: 'By issuer' });
  const instrByAdmin = await createTestInstruction(company.id, project.id, admin.id, { title: 'By admin' });

  w = {
    admin, issuer, otherConsultant, pm, supervisor, otherProjectConsultant,
    foreignAdmin: foreign.admin, foreignConsultant,
    projectId: project.id, foreignProjectId: foreignProject.id,
    instrByIssuer: instrByIssuer.id, instrByAdmin: instrByAdmin.id,
  };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

const url = (projectId: string, instructionId: string) =>
  `/api/v1/projects/${projectId}/instructions/${instructionId}/attachments`;

function attach(user: TestUser, instructionId: string, projectId = w.projectId) {
  const file = buildMultipartFile('note.pdf', 'application/pdf', Buffer.from(`%PDF-1.4 ${user.id}`));
  return app.inject({
    method: 'POST', url: url(projectId, instructionId),
    headers: { authorization: `Bearer ${user.accessToken}`, ...file.headers },
    payload: file.body,
  });
}

const get = (user: TestUser | null, path: string) =>
  app.inject({ method: 'GET', url: path, headers: user ? { authorization: `Bearer ${user.accessToken}` } : {} });

const rowsBy = (userId: string) => prisma.instructionAttachment.count({ where: { uploadedById: userId } });

/** Refused attempt: neither a database row nor a stored object results. */
async function expectNothingWritten(user: TestUser, run: () => Promise<unknown>) {
  const objectsBefore = memory.objects.size;
  const rowsBefore = await rowsBy(user.id);
  await run();
  expect(memory.objects.size).toBe(objectsBefore);
  expect(await rowsBy(user.id)).toBe(rowsBefore);
}

let issuerFileKey = '';

describe('adding attachments', () => {
  it('the issuing consultant can attach, and can download the file', async () => {
    const res = await attach(w.issuer, w.instrByIssuer);
    expect(res.statusCode).toBe(201);
    const { attachment } = res.json();
    expect(attachment.uploadedById).toBe(w.issuer.id);
    issuerFileKey = attachment.fileKey;
    expect(memory.objects.has(issuerFileKey)).toBe(true);

    const file = await get(w.issuer, attachment.fileUrl);
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.toString()).toBe(`%PDF-1.4 ${w.issuer.id}`);
  });

  it('another consultant on the project is refused with 403 and nothing is stored', async () => {
    await expectNothingWritten(w.otherConsultant, async () => {
      const res = await attach(w.otherConsultant, w.instrByIssuer);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({
        error: 'Consultants can only add attachments to instructions they issued',
        code: 'FORBIDDEN',
      });
    });
  });

  it('another consultant is refused on an instruction issued by an admin too', async () => {
    await expectNothingWritten(w.otherConsultant, async () => {
      expect((await attach(w.otherConsultant, w.instrByAdmin)).statusCode).toBe(403);
    });
  });

  it('a project manager on the project can attach to any instruction', async () => {
    expect((await attach(w.pm, w.instrByIssuer)).statusCode).toBe(201);
    expect((await attach(w.pm, w.instrByAdmin)).statusCode).toBe(201);
  });

  it('a company admin can attach to any instruction in the company', async () => {
    expect((await attach(w.admin, w.instrByIssuer)).statusCode).toBe(201);
  });

  it('a site supervisor is refused as before (role not allowed to attach)', async () => {
    await expectNothingWritten(w.supervisor, async () => {
      expect((await attach(w.supervisor, w.instrByIssuer)).statusCode).toBe(403);
    });
  });

  it('a consultant from another project of the same company is refused (403, project access)', async () => {
    await expectNothingWritten(w.otherProjectConsultant, async () => {
      const res = await attach(w.otherProjectConsultant, w.instrByIssuer);
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('You do not have access to this project');
    });
  });

  it('users from another company are refused (404, nothing disclosed)', async () => {
    await expectNothingWritten(w.foreignAdmin, async () => {
      const viaProject = await attach(w.foreignAdmin, w.instrByIssuer);
      expect(viaProject.statusCode).toBe(404);
      expect(viaProject.json().error).toBe('Project not found');
      // Own project id with a foreign instruction id: the instruction is not found.
      const viaOwnProject = await attach(w.foreignAdmin, w.instrByIssuer, w.foreignProjectId);
      expect(viaOwnProject.statusCode).toBe(404);
      expect(viaOwnProject.json().error).toBe('Instruction not found');
    });
    await expectNothingWritten(w.foreignConsultant, async () => {
      expect((await attach(w.foreignConsultant, w.instrByIssuer)).statusCode).toBe(404);
      expect((await attach(w.foreignConsultant, w.instrByIssuer, w.foreignProjectId)).statusCode).toBe(404);
    });
  });

  it('the issuer is still refused an edit by another consultant (existing rule, unchanged)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/v1/projects/${w.projectId}/instructions/${w.instrByIssuer}`,
      headers: { authorization: `Bearer ${w.otherConsultant.accessToken}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ title: 'changed' }),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('reading attachments (unchanged)', () => {
  it('another consultant on the project can still read the instruction and download its file', async () => {
    expect(issuerFileKey).not.toBe('');
    const detail = await get(w.otherConsultant, `/api/v1/projects/${w.projectId}/instructions/${w.instrByIssuer}`);
    expect(detail.statusCode).toBe(200);
    const fileNames = detail.json().instruction.attachments.map((a: { fileUrl: string }) => a.fileUrl);
    expect(fileNames).toContain(`/uploads/${issuerFileKey}`);

    const file = await get(w.otherConsultant, `/uploads/${issuerFileKey}`);
    expect(file.statusCode).toBe(200);
  });

  it('the file is refused to another project, another company and a signed-out caller', async () => {
    expect((await get(w.otherProjectConsultant, `/uploads/${issuerFileKey}`)).statusCode).toBe(404);
    expect((await get(w.foreignAdmin, `/uploads/${issuerFileKey}`)).statusCode).toBe(404);
    expect((await get(w.foreignConsultant, `/uploads/${issuerFileKey}`)).statusCode).toBe(404);
    expect((await get(null, `/uploads/${issuerFileKey}`)).statusCode).toBe(401);
  });

  it('the instruction itself is refused to another project and another company', async () => {
    const path = `/api/v1/projects/${w.projectId}/instructions/${w.instrByIssuer}`;
    expect((await get(w.otherProjectConsultant, path)).statusCode).toBe(403);
    expect((await get(w.foreignAdmin, path)).statusCode).toBe(404);
  });
});
