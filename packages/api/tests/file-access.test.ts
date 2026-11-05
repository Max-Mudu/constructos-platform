/**
 * GET /uploads/* — per-record permission checks.
 *
 * A file key is served only when the caller could read the record that owns it
 * through that record's own routes: same company, a view role for that
 * resource, an active project membership for non company-wide roles, the
 * supervisor's assigned site for delivery files, and contractor ownership for
 * instruction attachments. Every denial is a 404 so existence is not revealed.
 */
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestDelivery,
  createTestDrawing,
  createTestInstruction,
  createTestContractor,
  assignUserToProject,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

const UPLOAD_DIR = path.join(os.tmpdir(), 'construction-platform-test-uploads');
const writtenFiles: string[] = [];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await Promise.all(writtenFiles.map((f) => fs.rm(f, { force: true })));
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
});

async function writeFile(prefix: string, ext: string): Promise<string> {
  const key = `${prefix}/fa-${randomUUID()}.${ext}`;
  const full = path.join(UPLOAD_DIR, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, 'file-access-test-content');
  writtenFiles.push(full);
  return key;
}

function get(key: string, user: TestUser | { accessToken: string }) {
  return app.inject({
    method: 'GET',
    url: `/uploads/${key}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
}

/** Company with admin, one project and two sites. */
async function world(slug: string) {
  const { company, admin } = await createTestCompany(app, slug);
  const project = await createTestProject(company.id, `${slug} P`);
  const siteA = await createTestSite(company.id, project.id, `${slug} A`);
  const siteB = await createTestSite(company.id, project.id, `${slug} B`);
  return { company, admin, project, siteA, siteB };
}

async function user(companyId: string, role: UserRole, suffix: string) {
  return createTestUser(app, companyId, role, suffix);
}

async function deliveryPhoto(companyId: string, projectId: string, siteId: string, uploaderId: string) {
  const delivery = await createTestDelivery(companyId, projectId, siteId, uploaderId);
  const key = await writeFile('photos', 'jpg');
  await prisma.deliveryPhoto.create({
    data: {
      deliveryRecordId: delivery.id, companyId, fileUrl: `/uploads/${key}`, fileKey: key,
      fileName: 'p.jpg', fileSizeBytes: 10, uploadedById: uploaderId,
    },
  });
  return key;
}

async function deliveryDocument(companyId: string, projectId: string, siteId: string, uploaderId: string) {
  const delivery = await createTestDelivery(companyId, projectId, siteId, uploaderId);
  const key = await writeFile('documents', 'pdf');
  await prisma.deliveryDocument.create({
    data: {
      deliveryRecordId: delivery.id, companyId, fileUrl: `/uploads/${key}`, fileKey: key,
      fileName: 'd.pdf', fileSizeBytes: 10, fileType: 'application/pdf', uploadedById: uploaderId,
    },
  });
  return key;
}

async function drawingRevision(companyId: string, projectId: string, uploaderId: string) {
  const drawing = await createTestDrawing(companyId, projectId, uploaderId, { drawingNumber: `D-${randomUUID()}` });
  const key = await writeFile('drawings', 'pdf');
  await prisma.drawingRevision.create({
    data: {
      drawingId: drawing.id, companyId, revisionNumber: 'A', fileUrl: `/uploads/${key}`, fileKey: key,
      fileName: 'r.pdf', fileSizeBytes: 10, fileType: 'application/pdf', uploadedById: uploaderId,
    },
  });
  return key;
}

async function instructionAttachment(
  companyId: string, projectId: string, issuerId: string, contractorId?: string,
) {
  const instr = await createTestInstruction(companyId, projectId, issuerId, contractorId ? { contractorId } : {});
  const key = await writeFile('instructions', 'pdf');
  await prisma.instructionAttachment.create({
    data: {
      instructionId: instr.id, companyId, fileUrl: `/uploads/${key}`, fileKey: key,
      fileName: 'i.pdf', fileSizeBytes: 10, fileType: 'application/pdf', uploadedById: issuerId,
    },
  });
  return key;
}

// ─── Delivery photos ──────────────────────────────────────────────────────────

describe('GET /uploads/* — delivery photos', () => {
  it('company_admin gets 200 with the file body (positive control)', async () => {
    const w = await world('fa-dp-admin');
    const key = await deliveryPhoto(w.company.id, w.project.id, w.siteA.id, w.admin.id);
    const res = await get(key, w.admin);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('file-access-test-content');
  });

  it('another company\'s admin gets 404', async () => {
    const w = await world('fa-dp-xt');
    const other = await createTestCompany(app, 'fa-dp-xt-b');
    const key = await deliveryPhoto(w.company.id, w.project.id, w.siteA.id, w.admin.id);
    expect((await get(key, other.admin)).statusCode).toBe(404);
  });

  it('same-company project_manager who is not a member gets 404', async () => {
    const w = await world('fa-dp-pm-nm');
    const pm = await user(w.company.id, 'project_manager', 'fa-dp-pm-nm');
    const key = await deliveryPhoto(w.company.id, w.project.id, w.siteA.id, w.admin.id);
    expect((await get(key, pm)).statusCode).toBe(404);
  });

  it('project_manager member gets 200', async () => {
    const w = await world('fa-dp-pm-m');
    const pm = await user(w.company.id, 'project_manager', 'fa-dp-pm-m');
    await assignUserToProject(w.company.id, w.project.id, pm.id);
    const key = await deliveryPhoto(w.company.id, w.project.id, w.siteA.id, w.admin.id);
    expect((await get(key, pm)).statusCode).toBe(200);
  });

  it('removed project member gets 404', async () => {
    const w = await world('fa-dp-pm-rm');
    const pm = await user(w.company.id, 'project_manager', 'fa-dp-pm-rm');
    await assignUserToProject(w.company.id, w.project.id, pm.id);
    await prisma.projectMember.updateMany({ where: { userId: pm.id }, data: { removedAt: new Date() } });
    const key = await deliveryPhoto(w.company.id, w.project.id, w.siteA.id, w.admin.id);
    expect((await get(key, pm)).statusCode).toBe(404);
  });

  it('contractor and worker get 404 even as project members', async () => {
    const w = await world('fa-dp-roles');
    const contractor = await user(w.company.id, 'contractor', 'fa-dp-roles-c');
    const worker = await user(w.company.id, 'worker', 'fa-dp-roles-w');
    const consultant = await user(w.company.id, 'consultant', 'fa-dp-roles-k');
    for (const u of [contractor, worker, consultant]) {
      await assignUserToProject(w.company.id, w.project.id, u.id);
    }
    const key = await deliveryPhoto(w.company.id, w.project.id, w.siteA.id, w.admin.id);
    expect((await get(key, contractor)).statusCode).toBe(404);
    expect((await get(key, worker)).statusCode).toBe(404);
    expect((await get(key, consultant)).statusCode).toBe(404);
  });

  it('site_supervisor assigned to site A gets 404 for a site B photo and 200 for a site A photo', async () => {
    const w = await world('fa-dp-ss');
    const ss = await user(w.company.id, 'site_supervisor', 'fa-dp-ss');
    await assignUserToProject(w.company.id, w.project.id, ss.id, w.siteA.id);
    const keyA = await deliveryPhoto(w.company.id, w.project.id, w.siteA.id, w.admin.id);
    const keyB = await deliveryPhoto(w.company.id, w.project.id, w.siteB.id, w.admin.id);
    expect((await get(keyB, ss)).statusCode).toBe(404);
    expect((await get(keyA, ss)).statusCode).toBe(200);
  });

  it('finance_officer (company-wide) gets 200 without membership; viewer needs membership', async () => {
    const w = await world('fa-dp-fin');
    const fin = await user(w.company.id, 'finance_officer', 'fa-dp-fin');
    const viewer = await user(w.company.id, 'viewer', 'fa-dp-viewer');
    const key = await deliveryPhoto(w.company.id, w.project.id, w.siteA.id, w.admin.id);
    expect((await get(key, fin)).statusCode).toBe(200);
    expect((await get(key, viewer)).statusCode).toBe(404);
    await assignUserToProject(w.company.id, w.project.id, viewer.id);
    expect((await get(key, viewer)).statusCode).toBe(200);
  });

  it('unknown key gets 404', async () => {
    const w = await world('fa-dp-unknown');
    expect((await get(`photos/${randomUUID()}.jpg`, w.admin)).statusCode).toBe(404);
  });
});

// ─── Delivery documents ───────────────────────────────────────────────────────

describe('GET /uploads/* — delivery documents', () => {
  it('non-member PM 404, member PM 200, other-site supervisor 404', async () => {
    const w = await world('fa-dd');
    const pm = await user(w.company.id, 'project_manager', 'fa-dd-pm');
    const ss = await user(w.company.id, 'site_supervisor', 'fa-dd-ss');
    await assignUserToProject(w.company.id, w.project.id, ss.id, w.siteB.id);
    const key = await deliveryDocument(w.company.id, w.project.id, w.siteA.id, w.admin.id);

    expect((await get(key, pm)).statusCode).toBe(404);
    await assignUserToProject(w.company.id, w.project.id, pm.id);
    expect((await get(key, pm)).statusCode).toBe(200);
    expect((await get(key, ss)).statusCode).toBe(404);
  });
});

// ─── Drawing revisions ────────────────────────────────────────────────────────

describe('GET /uploads/* — drawing revisions', () => {
  it('non-member PM 404, member PM 200, member contractor 200, worker 404, other company 404', async () => {
    const w = await world('fa-dr');
    const other = await createTestCompany(app, 'fa-dr-b');
    const pm = await user(w.company.id, 'project_manager', 'fa-dr-pm');
    const contractor = await user(w.company.id, 'contractor', 'fa-dr-c');
    const worker = await user(w.company.id, 'worker', 'fa-dr-w');
    await assignUserToProject(w.company.id, w.project.id, contractor.id);
    await assignUserToProject(w.company.id, w.project.id, worker.id);
    const key = await drawingRevision(w.company.id, w.project.id, w.admin.id);

    expect((await get(key, w.admin)).statusCode).toBe(200);
    expect((await get(key, other.admin)).statusCode).toBe(404);
    expect((await get(key, pm)).statusCode).toBe(404);
    await assignUserToProject(w.company.id, w.project.id, pm.id);
    expect((await get(key, pm)).statusCode).toBe(200);
    expect((await get(key, contractor)).statusCode).toBe(200);
    expect((await get(key, worker)).statusCode).toBe(404);
  });

  it('member of a different project in the same company gets 404', async () => {
    const w = await world('fa-dr-proj');
    const otherProject = await createTestProject(w.company.id, 'fa-dr-proj other');
    const pm = await user(w.company.id, 'project_manager', 'fa-dr-proj');
    await assignUserToProject(w.company.id, otherProject.id, pm.id);
    const key = await drawingRevision(w.company.id, w.project.id, w.admin.id);
    expect((await get(key, pm)).statusCode).toBe(404);
  });

  it('finance_officer needs project membership, like the drawing routes', async () => {
    const w = await world('fa-dr-fin');
    const fin = await user(w.company.id, 'finance_officer', 'fa-dr-fin');
    const key = await drawingRevision(w.company.id, w.project.id, w.admin.id);

    expect((await get(key, fin)).statusCode).toBe(404);
    await assignUserToProject(w.company.id, w.project.id, fin.id);
    expect((await get(key, fin)).statusCode).toBe(200);
  });
});

// ─── Instruction attachments ──────────────────────────────────────────────────

describe('GET /uploads/* — instruction attachments', () => {
  it('contractor sees attachments only on instructions directed at their own contractor record', async () => {
    const w = await world('fa-ia-c');
    const cUser = await user(w.company.id, 'contractor', 'fa-ia-c');
    const otherCUser = await user(w.company.id, 'contractor', 'fa-ia-c2');
    await assignUserToProject(w.company.id, w.project.id, cUser.id);
    await assignUserToProject(w.company.id, w.project.id, otherCUser.id);
    const own = await createTestContractor(w.company.id, 'Own Co', cUser.id);
    await createTestContractor(w.company.id, 'Other Co', otherCUser.id);

    const ownKey = await instructionAttachment(w.company.id, w.project.id, w.admin.id, own.id);
    const generalKey = await instructionAttachment(w.company.id, w.project.id, w.admin.id);

    expect((await get(ownKey, cUser)).statusCode).toBe(200);
    expect((await get(ownKey, otherCUser)).statusCode).toBe(404);
    expect((await get(generalKey, cUser)).statusCode).toBe(404);
    expect((await get(generalKey, w.admin)).statusCode).toBe(200);
  });

  it('non-member consultant 404, member consultant 200, worker 404, other company 404', async () => {
    const w = await world('fa-ia-k');
    const other = await createTestCompany(app, 'fa-ia-k-b');
    const consultant = await user(w.company.id, 'consultant', 'fa-ia-k');
    const worker = await user(w.company.id, 'worker', 'fa-ia-k-w');
    await assignUserToProject(w.company.id, w.project.id, worker.id);
    const key = await instructionAttachment(w.company.id, w.project.id, w.admin.id);

    expect((await get(key, consultant)).statusCode).toBe(404);
    await assignUserToProject(w.company.id, w.project.id, consultant.id);
    expect((await get(key, consultant)).statusCode).toBe(200);
    expect((await get(key, worker)).statusCode).toBe(404);
    expect((await get(key, other.admin)).statusCode).toBe(404);
  });

  it('finance_officer needs project membership, like the instruction routes', async () => {
    const w = await world('fa-ia-fin');
    const fin = await user(w.company.id, 'finance_officer', 'fa-ia-fin');
    const key = await instructionAttachment(w.company.id, w.project.id, w.admin.id);

    expect((await get(key, fin)).statusCode).toBe(404);
    await assignUserToProject(w.company.id, w.project.id, fin.id);
    expect((await get(key, fin)).statusCode).toBe(200);
  });
});
