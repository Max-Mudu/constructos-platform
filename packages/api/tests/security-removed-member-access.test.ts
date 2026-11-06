/**
 * NEEDS OWNER APPROVAL — authorization behaviour change.
 *
 * A finance_officer passes requireProjectAccess without a membership row
 * (company-wide role), and drawing.service / instruction.service then require
 * a membership — but their check ignored `removedAt`, so a finance_officer
 * REMOVED from a project kept reading its drawings and instructions (while
 * file-access.service already refused the files themselves). The services now
 * require an active (removedAt = null) membership.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  clearDatabase, createTestCompany, createTestUser, createTestProject, assignUserToProject,
  createTestDrawing, createTestInstruction,
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

async function setup(slug: string) {
  const { company, admin } = await createTestCompany(app, slug);
  const project = await createTestProject(company.id);
  const fo = await createTestUser(app, company.id, 'finance_officer', slug, { canViewFinance: true });
  await assignUserToProject(company.id, project.id, fo.id);
  const drawing = await createTestDrawing(company.id, project.id, admin.id);
  const instruction = await createTestInstruction(company.id, project.id, admin.id);
  return { company, project, fo, drawing, instruction };
}

const get = (token: string, url: string) =>
  app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });

describe('removed finance_officer loses drawings and instructions', () => {
  it('an active member can read them', async () => {
    const s = await setup('removed-fo-active');
    expect((await get(s.fo.accessToken, `/api/v1/projects/${s.project.id}/drawings`)).statusCode).toBe(200);
    expect((await get(s.fo.accessToken, `/api/v1/projects/${s.project.id}/drawings/${s.drawing.id}`)).statusCode).toBe(200);
    expect((await get(s.fo.accessToken, `/api/v1/projects/${s.project.id}/instructions`)).statusCode).toBe(200);
    expect((await get(s.fo.accessToken, `/api/v1/projects/${s.project.id}/instructions/${s.instruction.id}`)).statusCode).toBe(200);
  });

  it('a removed member gets 403 on every drawing and instruction read', async () => {
    const s = await setup('removed-fo-removed');
    await prisma.projectMember.updateMany({
      where: { projectId: s.project.id, userId: s.fo.id },
      data:  { removedAt: new Date() },
    });
    for (const url of [
      `/api/v1/projects/${s.project.id}/drawings`,
      `/api/v1/projects/${s.project.id}/drawings/${s.drawing.id}`,
      `/api/v1/projects/${s.project.id}/instructions`,
      `/api/v1/projects/${s.project.id}/instructions/${s.instruction.id}`,
    ]) {
      expect({ url, status: (await get(s.fo.accessToken, url)).statusCode }).toEqual({ url, status: 403 });
    }
  });

  it('a re-added member regains access', async () => {
    const s = await setup('removed-fo-readded');
    await prisma.projectMember.updateMany({
      where: { projectId: s.project.id, userId: s.fo.id },
      data:  { removedAt: new Date() },
    });
    // (projectId, userId) is unique: re-adding restores the same row.
    await prisma.projectMember.updateMany({
      where: { projectId: s.project.id, userId: s.fo.id },
      data:  { removedAt: null },
    });
    expect((await get(s.fo.accessToken, `/api/v1/projects/${s.project.id}/drawings`)).statusCode).toBe(200);
    expect((await get(s.fo.accessToken, `/api/v1/projects/${s.project.id}/instructions`)).statusCode).toBe(200);
  });
});
