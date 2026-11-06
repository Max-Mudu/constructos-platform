/**
 * Drawing revision comments are addressed through
 * /projects/:projectId/drawings/:drawingId/revisions/:revisionId/comments.
 * The drawing must belong to :projectId; a drawing of another project in the
 * same company answers exactly like a missing one (404).
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  assignUserToProject, clearDatabase, createTestCompany, createTestDrawing,
  createTestProject, createTestRevision, createTestUser, TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
});

const auth = (u: TestUser) => ({ authorization: `Bearer ${u.accessToken}` });

async function world() {
  const { company, admin } = await createTestCompany(app, 'dwg-comment-project');
  const projectA = await createTestProject(company.id, 'Project A');
  const projectB = await createTestProject(company.id, 'Project B');
  const consultantA = await createTestUser(app, company.id, 'consultant', 'a');
  await assignUserToProject(company.id, projectA.id, consultantA.id);
  const consultantB = await createTestUser(app, company.id, 'consultant', 'b');
  await assignUserToProject(company.id, projectB.id, consultantB.id);

  const drawingB = await createTestDrawing(company.id, projectB.id, admin.id, { drawingNumber: 'B-001' });
  const revisionB = await createTestRevision(drawingB.id, company.id, admin.id);
  await prisma.drawingComment.create({
    data: { companyId: company.id, drawingId: drawingB.id, revisionId: revisionB.id, userId: admin.id, text: 'B only' },
  });
  return { admin, projectA, projectB, consultantA, consultantB, drawingB, revisionB };
}

const commentsUrl = (projectId: string, drawingId: string, revisionId: string) =>
  `/api/v1/projects/${projectId}/drawings/${drawingId}/revisions/${revisionId}/comments`;

describe('drawing comments are bound to the project in the URL', () => {
  it('positive control: a member of the drawing\'s project lists and adds comments', async () => {
    const w = await world();
    const list = await app.inject({
      method: 'GET', url: commentsUrl(w.projectB.id, w.drawingB.id, w.revisionB.id), headers: auth(w.consultantB),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().comments).toHaveLength(1);

    const add = await app.inject({
      method: 'POST', url: commentsUrl(w.projectB.id, w.drawingB.id, w.revisionB.id),
      headers: auth(w.consultantB), payload: { text: 'ok' },
    });
    expect(add.statusCode).toBe(201);
  });

  it('a member of another project gets 404 listing comments through their own project id', async () => {
    const w = await world();
    const res = await app.inject({
      method: 'GET', url: commentsUrl(w.projectA.id, w.drawingB.id, w.revisionB.id), headers: auth(w.consultantA),
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('B only');
  });

  it('a member of another project gets 404 adding a comment and nothing is stored', async () => {
    const w = await world();
    const res = await app.inject({
      method: 'POST', url: commentsUrl(w.projectA.id, w.drawingB.id, w.revisionB.id),
      headers: auth(w.consultantA), payload: { text: 'should not land' },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.drawingComment.count({ where: { text: 'should not land' } })).toBe(0);
  });

  it('company admin also gets 404 when the URL project does not own the drawing', async () => {
    const w = await world();
    const res = await app.inject({
      method: 'GET', url: commentsUrl(w.projectA.id, w.drawingB.id, w.revisionB.id), headers: auth(w.admin),
    });
    expect(res.statusCode).toBe(404);
  });
});
