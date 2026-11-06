/**
 * Security regression: an instruction or daily target in company A cannot be
 * linked to company B's rows by id. Before the fix:
 *  - PATCH instruction skipped link validation unless siteId / contractorId /
 *    drawingId was sent, so milestoneId / workPackageId / revisionId from
 *    another company were stored and their names/status echoed back;
 *  - POST instruction checked revisionId only when drawingId was also sent;
 *  - PATCH target stored any workerId, echoing the other company's worker
 *    name and trade.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  clearDatabase, createTestCompany, createTestProject, createTestSite, createTestContractor,
  createTestWorkPackage, createTestScheduleTask, createTestDrawing, createTestRevision,
  createTestInstruction, createTestTarget, createTestWorker,
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

async function setup() {
  const a = await createTestCompany(app, 'xt-links-a');
  const b = await createTestCompany(app, 'xt-links-b');
  const projectA = await createTestProject(a.company.id, 'A project');
  const siteA    = await createTestSite(a.company.id, projectA.id, 'A site');
  const projectB = await createTestProject(b.company.id, 'B project');
  const siteB    = await createTestSite(b.company.id, projectB.id, 'B site');

  const contractorB = await createTestContractor(b.company.id, 'B contractor');
  const pkgB  = await createTestWorkPackage(b.company.id, projectB.id, siteB.id, contractorB.id, b.admin.id, 'B SECRET PACKAGE');
  const taskB = await createTestScheduleTask(b.company.id, projectB.id, siteB.id, contractorB.id, b.admin.id);
  const milestoneB = await prisma.scheduleMilestone.create({
    data: {
      companyId: b.company.id, projectId: projectB.id, siteId: siteB.id, taskId: taskB.id,
      name: 'B SECRET MILESTONE', plannedDate: new Date('2026-12-01'),
    },
  });
  const drawingB  = await createTestDrawing(b.company.id, projectB.id, b.admin.id);
  const revisionB = await createTestRevision(drawingB.id, b.company.id, b.admin.id, { revisionNumber: 'B-SECRET-REV' });
  const workerB   = await createTestWorker(b.company.id);

  const instructionA = await createTestInstruction(a.company.id, projectA.id, a.admin.id);
  const targetA      = await createTestTarget(a.company.id, projectA.id, siteA.id, a.admin.id);

  return { a, projectA, siteA, pkgB, milestoneB, revisionB, workerB, instructionA, targetA };
}

const instrUrl = (pid: string, id?: string) =>
  `/api/v1/projects/${pid}/instructions${id ? `/${id}` : ''}`;

describe('instruction links are tenant-bound', () => {
  it.each([
    ['milestoneId',   (s: Awaited<ReturnType<typeof setup>>) => s.milestoneB.id],
    ['workPackageId', (s: Awaited<ReturnType<typeof setup>>) => s.pkgB.id],
    ['revisionId',    (s: Awaited<ReturnType<typeof setup>>) => s.revisionB.id],
  ])('PATCH with another company\'s %s is a 404 and stores nothing', async (field, pick) => {
    const s = await setup();
    const res = await app.inject({
      method: 'PATCH',
      url:    instrUrl(s.projectA.id, s.instructionA.id),
      headers: { authorization: `Bearer ${s.a.admin.accessToken}` },
      payload: { [field]: pick(s) },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('SECRET');

    const row = await prisma.consultantInstruction.findUniqueOrThrow({ where: { id: s.instructionA.id } });
    expect(row.milestoneId).toBeNull();
    expect(row.workPackageId).toBeNull();
    expect(row.revisionId).toBeNull();
  });

  it('POST with another company\'s revisionId and no drawingId is a 404', async () => {
    const s = await setup();
    const res = await app.inject({
      method: 'POST',
      url:    instrUrl(s.projectA.id),
      headers: { authorization: `Bearer ${s.a.admin.accessToken}` },
      payload: { type: 'instruction', title: 'Linked', issuedDate: '2026-11-06', revisionId: s.revisionB.id },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('SECRET');
    expect(await prisma.consultantInstruction.count({ where: { revisionId: s.revisionB.id } })).toBe(0);
  });

  it('still accepts a same-project revision without a drawingId', async () => {
    const s = await setup();
    const drawingA  = await createTestDrawing(s.a.company.id, s.projectA.id, s.a.admin.id);
    const revisionA = await createTestRevision(drawingA.id, s.a.company.id, s.a.admin.id);
    const res = await app.inject({
      method: 'PATCH',
      url:    instrUrl(s.projectA.id, s.instructionA.id),
      headers: { authorization: `Bearer ${s.a.admin.accessToken}` },
      payload: { revisionId: revisionA.id },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('daily target worker link is tenant-bound', () => {
  it('PATCH with another company\'s workerId is a 404 and stores nothing', async () => {
    const s = await setup();
    const res = await app.inject({
      method: 'PATCH',
      url:    `/api/v1/projects/${s.projectA.id}/sites/${s.siteA.id}/targets/${s.targetA.id}`,
      headers: { authorization: `Bearer ${s.a.admin.accessToken}` },
      payload: { workerId: s.workerB.id },
    });
    expect(res.statusCode).toBe(404);
    const row = await prisma.dailyTarget.findUniqueOrThrow({ where: { id: s.targetA.id } });
    expect(row.workerId).toBeNull();
  });

  it('still accepts a worker from the same company', async () => {
    const s = await setup();
    const workerA = await createTestWorker(s.a.company.id);
    const res = await app.inject({
      method: 'PATCH',
      url:    `/api/v1/projects/${s.projectA.id}/sites/${s.siteA.id}/targets/${s.targetA.id}`,
      headers: { authorization: `Bearer ${s.a.admin.accessToken}` },
      payload: { workerId: workerA.id },
    });
    expect(res.statusCode).toBe(200);
  });
});
