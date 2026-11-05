/**
 * Worker visibility scope (PII) for non company-wide roles.
 *
 *   - project_manager: workers with an ACTIVE assignment on a project where the
 *     PM is an ACTIVE member.
 *   - site_supervisor: workers with an active assignment on a site the
 *     supervisor is explicitly assigned to.
 *   - company_admin / finance_officer: every worker in the company.
 *
 * The ?projectId= / ?siteId= list filters narrow that scope (AND) — they must
 * never widen it. GET/PATCH/DELETE /workers/:id apply the same rule: outside
 * scope → 404 (the record's existence is not confirmed).
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

// ─── World ────────────────────────────────────────────────────────────────────
//
// Company A
//   P1 ── S1:  W1          P1 ── S1b: W1b
//   P2 ── S2:  W2          WU: unassigned       WR: assignment on S1 removed
//   pm      = project_manager, member of P1
//   pmGone  = project_manager whose P1 membership was removed
//   sup     = site_supervisor assigned to P1/S1 only
// Company B: worker WB

interface World {
  admin: TestUser; finance: TestUser; pm: TestUser; pmGone: TestUser; sup: TestUser; adminB: TestUser;
  p1: string; s1: string; s1b: string; p2: string; s2: string;
  w1: string; w1b: string; w2: string; wu: string; wr: string; wb: string;
}

let w: World;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'worker-scope-a');
  const cid = a.company.id;
  const finance = await createTestUser(app, cid, 'finance_officer', 'ws-fo');
  const pm      = await createTestUser(app, cid, 'project_manager', 'ws-pm', { canViewFinance: true });
  const pmGone  = await createTestUser(app, cid, 'project_manager', 'ws-pmgone', { canViewFinance: true });
  const sup     = await createTestUser(app, cid, 'site_supervisor', 'ws-sup');

  const p1  = await createTestProject(cid, 'P1');
  const s1  = await createTestSite(cid, p1.id, 'S1');
  const s1b = await createTestSite(cid, p1.id, 'S1b');
  const p2  = await createTestProject(cid, 'P2');
  const s2  = await createTestSite(cid, p2.id, 'S2');

  await assignUserToProject(cid, p1.id, pm.id);
  await assignUserToProject(cid, p1.id, pmGone.id);
  await prisma.projectMember.updateMany({ where: { userId: pmGone.id }, data: { removedAt: new Date() } });
  await assignUserToProject(cid, p1.id, sup.id, s1.id);

  const w1  = await createTestWorker(cid, { firstName: 'One' });
  const w1b = await createTestWorker(cid, { firstName: 'OneB' });
  const w2  = await createTestWorker(cid, { firstName: 'Two' });
  const wu  = await createTestWorker(cid, { firstName: 'Unassigned' });
  const wr  = await createTestWorker(cid, { firstName: 'Removed' });
  await assignWorkerToSite(cid, p1.id, s1.id, w1.id, a.admin.id);
  await assignWorkerToSite(cid, p1.id, s1b.id, w1b.id, a.admin.id);
  await assignWorkerToSite(cid, p2.id, s2.id, w2.id, a.admin.id);
  await assignWorkerToSite(cid, p1.id, s1.id, wr.id, a.admin.id);
  await prisma.workerAssignment.updateMany({ where: { workerId: wr.id }, data: { removedAt: new Date() } });

  const b = await createTestCompany(app, 'worker-scope-b');
  const wb = await createTestWorker(b.company.id, { firstName: 'Bee' });

  w = {
    admin: a.admin, finance, pm, pmGone, sup, adminB: b.admin,
    p1: p1.id, s1: s1.id, s1b: s1b.id, p2: p2.id, s2: s2.id,
    w1: w1.id, w1b: w1b.id, w2: w2.id, wu: wu.id, wr: wr.id, wb: wb.id,
  };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

function req(user: TestUser, method: 'GET' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    ...(payload && { payload }),
  });
}

async function listIds(user: TestUser, query = ''): Promise<string[]> {
  const res = await req(user, 'GET', `/workers${query}`);
  expect(res.statusCode).toBe(200);
  return (res.json().workers as Array<{ id: string }>).map((x) => x.id).sort();
}

const sorted = (...ids: string[]) => [...ids].sort();

// ─── List: filters narrow, never widen ────────────────────────────────────────

describe('GET /workers — ?projectId= / ?siteId= cannot widen role scope', () => {
  it('PM: ?projectId=<non-member project> returns nothing (was: that project\'s workers)', async () => {
    expect(await listIds(w.pm, `?projectId=${w.p2}`)).toEqual([]);
  });

  it('PM: ?siteId=<site on non-member project> returns nothing', async () => {
    expect(await listIds(w.pm, `?siteId=${w.s2}`)).toEqual([]);
  });

  it('supervisor: ?siteId=<unassigned site in same project> returns nothing', async () => {
    expect(await listIds(w.sup, `?siteId=${w.s1b}`)).toEqual([]);
  });

  it('supervisor: ?projectId=<own project> returns only own-site workers', async () => {
    expect(await listIds(w.sup, `?projectId=${w.p1}`)).toEqual([w.w1]);
  });

  it('supervisor: ?projectId=<other project> returns nothing', async () => {
    expect(await listIds(w.sup, `?projectId=${w.p2}`)).toEqual([]);
  });

  it('PM with removed membership sees nothing, with or without filters', async () => {
    expect(await listIds(w.pmGone)).toEqual([]);
    expect(await listIds(w.pmGone, `?projectId=${w.p1}`)).toEqual([]);
  });

  it('positive controls: in-scope filters still work', async () => {
    expect(await listIds(w.pm)).toEqual(sorted(w.w1, w.w1b));
    expect(await listIds(w.pm, `?projectId=${w.p1}`)).toEqual(sorted(w.w1, w.w1b));
    expect(await listIds(w.pm, `?siteId=${w.s1b}`)).toEqual([w.w1b]);
    expect(await listIds(w.sup)).toEqual([w.w1]);
    expect(await listIds(w.sup, `?siteId=${w.s1}`)).toEqual([w.w1]);
    expect(await listIds(w.admin, `?projectId=${w.p2}`)).toEqual([w.w2]);
    expect(await listIds(w.finance, `?siteId=${w.s1b}`)).toEqual([w.w1b]);
  });

  it('siteId and projectId together are intersected (not last-one-wins)', async () => {
    expect(await listIds(w.admin, `?siteId=${w.s1}&projectId=${w.p2}`)).toEqual([]);
    expect(await listIds(w.admin, `?siteId=${w.s1}&projectId=${w.p1}`)).toEqual([w.w1]); // WR's assignment is removed
  });
});

// ─── Detail ───────────────────────────────────────────────────────────────────

describe('GET /workers/:id — same scope as the list', () => {
  it.each([
    ['worker only on a non-member project', () => w.w2],
    ['unassigned worker', () => w.wu],
    ['worker whose only assignment was removed', () => w.wr],
  ])('PM: %s → 404', async (_l, id) => {
    const res = await req(w.pm, 'GET', `/workers/${id()}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it('supervisor: worker on another site of the same project → 404', async () => {
    expect((await req(w.sup, 'GET', `/workers/${w.w1b}`)).statusCode).toBe(404);
    expect((await req(w.sup, 'GET', `/workers/${w.w2}`)).statusCode).toBe(404);
  });

  it('PM with removed membership → 404', async () => {
    expect((await req(w.pmGone, 'GET', `/workers/${w.w1}`)).statusCode).toBe(404);
  });

  it('positive controls: in-scope detail is readable', async () => {
    expect((await req(w.pm, 'GET', `/workers/${w.w1}`)).statusCode).toBe(200);
    expect((await req(w.pm, 'GET', `/workers/${w.w1b}`)).statusCode).toBe(200);
    expect((await req(w.sup, 'GET', `/workers/${w.w1}`)).statusCode).toBe(200);
    for (const id of [w.w2, w.wu, w.wr]) {
      expect((await req(w.admin, 'GET', `/workers/${id}`)).statusCode).toBe(200);
      expect((await req(w.finance, 'GET', `/workers/${id}`)).statusCode).toBe(200);
    }
  });

  it('cross-tenant stays 404', async () => {
    expect((await req(w.admin, 'GET', `/workers/${w.wb}`)).statusCode).toBe(404);
    expect((await req(w.adminB, 'GET', `/workers/${w.w1}`)).statusCode).toBe(404);
  });
});

// ─── Writes ───────────────────────────────────────────────────────────────────

describe('PATCH /workers/:id — same scope as the list', () => {
  it('PM cannot edit a worker outside scope → 404, row unchanged', async () => {
    for (const id of [w.w2, w.wu]) {
      const res = await req(w.pm, 'PATCH', `/workers/${id}`, { trade: 'Hijacked' });
      expect(res.statusCode).toBe(404);
      const row = await prisma.worker.findUniqueOrThrow({ where: { id } });
      expect(row.trade).not.toBe('Hijacked');
    }
  });

  it('PM with removed membership cannot edit → 404', async () => {
    const res = await req(w.pmGone, 'PATCH', `/workers/${w.w1}`, { trade: 'Hijacked' });
    expect(res.statusCode).toBe(404);
  });

  it('PM may edit an in-scope worker; admin may edit any', async () => {
    const pmRes = await req(w.pm, 'PATCH', `/workers/${w.w1b}`, { trade: 'Plumber' });
    expect(pmRes.statusCode).toBe(200);
    expect(pmRes.json().worker.trade).toBe('Plumber');
    const adminRes = await req(w.admin, 'PATCH', `/workers/${w.wu}`, { trade: 'Painter' });
    expect(adminRes.statusCode).toBe(200);
  });

  it('company_admin can still deactivate any company worker', async () => {
    const res = await req(w.admin, 'DELETE', `/workers/${w.wu}`);
    expect(res.statusCode).toBe(204);
  });
});
