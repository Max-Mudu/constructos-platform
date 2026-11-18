/**
 * GET /projects/:projectId/sites/:siteId/workers follows the same site rule
 * as every other site route (getAccessibleSiteIds): a site_supervisor whose
 * membership names a site sees only that site's workers; any other site of
 * the project is answered with the generic 404. Project-wide roles and a
 * supervisor with a project-wide membership are unchanged.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestWorker,
  assignWorkerToSite,
  assignUserToProject,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

interface World {
  admin: TestUser; finance: TestUser; pm: TestUser; sup: TestUser; supWide: TestUser; supGone: TestUser;
  adminB: TestUser;
  p1: string; s1: string; s1b: string;
  w1: string; w1b: string;
}
let w: World;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'site-workers-a');
  const cid = a.company.id;
  const finance = await createTestUser(app, cid, 'finance_officer', 'sw-fo');
  const pm      = await createTestUser(app, cid, 'project_manager', 'sw-pm');
  const sup     = await createTestUser(app, cid, 'site_supervisor', 'sw-sup');
  const supWide = await createTestUser(app, cid, 'site_supervisor', 'sw-supwide');
  const supGone = await createTestUser(app, cid, 'site_supervisor', 'sw-supgone');

  const p1  = await createTestProject(cid, 'SW-P1');
  const s1  = await createTestSite(cid, p1.id, 'SW-S1');
  const s1b = await createTestSite(cid, p1.id, 'SW-S1b');

  await assignUserToProject(cid, p1.id, pm.id);
  await assignUserToProject(cid, p1.id, sup.id, s1.id);
  await assignUserToProject(cid, p1.id, supWide.id);
  await assignUserToProject(cid, p1.id, supGone.id, s1.id);
  await prisma.projectMember.updateMany({ where: { userId: supGone.id }, data: { removedAt: new Date() } });

  const w1  = await createTestWorker(cid, { firstName: 'SiteOne' });
  const w1b = await createTestWorker(cid, { firstName: 'SiteOneB' });
  await assignWorkerToSite(cid, p1.id, s1.id, w1.id, a.admin.id);
  await assignWorkerToSite(cid, p1.id, s1b.id, w1b.id, a.admin.id);

  const b = await createTestCompany(app, 'site-workers-b');

  w = {
    admin: a.admin, finance, pm, sup, supWide, supGone, adminB: b.admin,
    p1: p1.id, s1: s1.id, s1b: s1b.id, w1: w1.id, w1b: w1b.id,
  };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

function list(user: TestUser, siteId: string) {
  return app.inject({
    method: 'GET',
    url: `/api/v1/projects/${w.p1}/sites/${siteId}/workers`,
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
}

const ids = (res: { json: () => { workers: Array<{ id: string }> } }) =>
  res.json().workers.map((x) => x.id).sort();

describe('GET /projects/:projectId/sites/:siteId/workers — site scope', () => {
  it('site_supervisor: own site lists its workers', async () => {
    const res = await list(w.sup, w.s1);
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual([w.w1]);
  });

  it('site_supervisor: another site of the same project is 404 with no worker data', async () => {
    const res = await list(w.sup, w.s1b);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(w.w1b);
    expect(res.body).not.toContain('SiteOneB');
  });

  it('site_supervisor with a project-wide membership: every site of the project', async () => {
    const r1 = await list(w.supWide, w.s1);
    const r2 = await list(w.supWide, w.s1b);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(ids(r1)).toEqual([w.w1]);
    expect(ids(r2)).toEqual([w.w1b]);
  });

  it('site_supervisor whose membership was removed: 403, no worker data', async () => {
    const res = await list(w.supGone, w.s1);
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain(w.w1);
  });

  it.each([
    ['company_admin', () => w.admin],
    ['finance_officer', () => w.finance],
    ['project_manager (member)', () => w.pm],
  ])('%s: both sites unchanged', async (_label, who) => {
    const r1 = await list(who(), w.s1);
    const r2 = await list(who(), w.s1b);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(ids(r1)).toEqual([w.w1]);
    expect(ids(r2)).toEqual([w.w1b]);
  });

  it('another company: 404', async () => {
    const res = await list(w.adminB, w.s1);
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(w.w1);
  });
});
