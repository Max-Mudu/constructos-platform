/**
 * Creator re-visibility for workers (read only).
 *
 * A worker's original creator (project_manager or site_supervisor) regains
 * READ visibility (GET /workers, GET /workers/:id) once every active
 * assignment of that worker has been removed, provided the creator still holds
 * an authorised context in the company (an active project membership for a PM,
 * an active site membership for a supervisor). It grants nothing else: PATCH,
 * DELETE, assignment, wage visibility and wage writes are decided as before.
 *
 * Every step goes through the real API: the creator registers the worker
 * (POST /workers; supervisors cannot, so their rows are attributed directly),
 * the company admin assigns and removes it through the site-worker routes, and
 * the creator then lists / reads it.
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
  assignUserToProject,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

// Company A: P1 (S1), P2 (S2), P3 (S3)
//   pm, pm2, pmLose        project_managers, members of P1 (pm, pmLose are creators)
//   sup, sup2, supLose     site_supervisors on P1/S1 (sup, supLose are creators)
// Company B: PB (SB); pmB project_manager on PB, supB site_supervisor on PB/SB
interface World {
  cidA: string; cidB: string;
  admin: TestUser; adminB: TestUser; finance: TestUser;
  pm: TestUser; pm2: TestUser; pmLose: TestUser;
  sup: TestUser; sup2: TestUser; supLose: TestUser;
  pmB: TestUser; supB: TestUser;
  p1: string; s1: string; p2: string; s2: string; p3: string; s3: string;
  pb: string; sb: string;
}
let w: World;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'worker-revis-a');
  const cid = a.company.id;
  const finance = await createTestUser(app, cid, 'finance_officer', 'wr-fo');
  const pm      = await createTestUser(app, cid, 'project_manager', 'wr-pm', { canViewFinance: true });
  const pm2     = await createTestUser(app, cid, 'project_manager', 'wr-pm2', { canViewFinance: true });
  const pmLose  = await createTestUser(app, cid, 'project_manager', 'wr-pmlose');
  const sup     = await createTestUser(app, cid, 'site_supervisor', 'wr-sup');
  const sup2    = await createTestUser(app, cid, 'site_supervisor', 'wr-sup2');
  const supLose = await createTestUser(app, cid, 'site_supervisor', 'wr-suplose');

  const p1 = await createTestProject(cid, 'P1');
  const s1 = await createTestSite(cid, p1.id, 'S1');
  const p2 = await createTestProject(cid, 'P2');
  const s2 = await createTestSite(cid, p2.id, 'S2');
  const p3 = await createTestProject(cid, 'P3');
  const s3 = await createTestSite(cid, p3.id, 'S3');
  await assignUserToProject(cid, p1.id, pm.id);
  await assignUserToProject(cid, p1.id, pm2.id);
  await assignUserToProject(cid, p1.id, pmLose.id);
  await assignUserToProject(cid, p1.id, sup.id, s1.id);
  await assignUserToProject(cid, p1.id, sup2.id, s1.id);
  await assignUserToProject(cid, p1.id, supLose.id, s1.id);

  const b = await createTestCompany(app, 'worker-revis-b');
  const pmB  = await createTestUser(app, b.company.id, 'project_manager', 'wr-pmb');
  const supB = await createTestUser(app, b.company.id, 'site_supervisor', 'wr-supb');
  const pb = await createTestProject(b.company.id, 'PB');
  const sb = await createTestSite(b.company.id, pb.id, 'SB');
  await assignUserToProject(b.company.id, pb.id, pmB.id);
  await assignUserToProject(b.company.id, pb.id, supB.id, sb.id);

  w = {
    cidA: cid, cidB: b.company.id,
    admin: a.admin, adminB: b.admin, finance,
    pm, pm2, pmLose, sup, sup2, supLose, pmB, supB,
    p1: p1.id, s1: s1.id, p2: p2.id, s2: s2.id, p3: p3.id, s3: s3.id,
    pb: pb.id, sb: sb.id,
  };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

function req(
  user: TestUser,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    ...(payload && { payload }),
  });
}

async function listIds(user: TestUser): Promise<string[]> {
  const res = await req(user, 'GET', '/workers');
  expect(res.statusCode).toBe(200);
  return (res.json().workers as Array<{ id: string }>).map((x) => x.id);
}

async function expectVisible(user: TestUser, id: string): Promise<void> {
  expect(await listIds(user)).toContain(id);
  const res = await req(user, 'GET', `/workers/${id}`);
  expect(res.statusCode).toBe(200);
  expect(res.json().worker.id).toBe(id);
}

async function expectHidden(user: TestUser, id: string): Promise<void> {
  expect(await listIds(user)).not.toContain(id);
  expect((await req(user, 'GET', `/workers/${id}`)).statusCode).toBe(404);
}

/** PM registers a worker through the API (the real creation path). */
async function pmCreates(user: TestUser, firstName: string): Promise<string> {
  const res = await req(user, 'POST', '/workers', { firstName, lastName: 'Revis' });
  expect(res.statusCode).toBe(201);
  return res.json().worker.id as string;
}

/** Worker row attributed to `creatorId` (supervisors cannot POST /workers). */
async function insertCreatedBy(companyId: string, creatorId: string, firstName: string): Promise<string> {
  const row = await createTestWorker(companyId, { firstName });
  await prisma.worker.update({ where: { id: row.id }, data: { createdById: creatorId } });
  return row.id;
}

/** Company admin assigns through the normal route. */
async function assign(admin: TestUser, projectId: string, siteId: string, workerId: string): Promise<void> {
  const res = await req(admin, 'POST', `/projects/${projectId}/sites/${siteId}/workers`, { workerId });
  expect(res.statusCode).toBe(201);
}

/** Company admin removes the assignment through the normal route. */
async function unassign(admin: TestUser, projectId: string, siteId: string, workerId: string): Promise<void> {
  const res = await req(admin, 'DELETE', `/projects/${projectId}/sites/${siteId}/workers/${workerId}`);
  expect(res.statusCode).toBe(204);
}

// ─── PM creator ───────────────────────────────────────────────────────────────

describe('PM creator: re-visibility after all assignments are removed', () => {
  it('assigned to a project the creator is not on: hidden', async () => {
    const id = await pmCreates(w.pm, 'Away');
    await expectVisible(w.pm, id);
    await assign(w.admin, w.p2, w.s2, id);
    await expectHidden(w.pm, id);
  });

  it('all assignments removed: visible again in list and get', async () => {
    const id = await pmCreates(w.pm, 'Back');
    await assign(w.admin, w.p2, w.s2, id);
    await expectHidden(w.pm, id);
    await unassign(w.admin, w.p2, w.s2, id);
    await expectVisible(w.pm, id);
    expect((await req(w.pm, 'GET', `/workers/${id}`)).json().worker.assignments).toEqual([]);
  });

  it('two out-of-scope assignments: removing one keeps it hidden; removing both shows it', async () => {
    const id = await pmCreates(w.pm, 'TwoAway');
    await assign(w.admin, w.p2, w.s2, id);
    await assign(w.admin, w.p3, w.s3, id);
    await unassign(w.admin, w.p2, w.s2, id);
    await expectHidden(w.pm, id);
    await unassign(w.admin, w.p3, w.s3, id);
    await expectVisible(w.pm, id);
  });

  it('one in-scope + one out-of-scope: removing the in-scope one hides it until the other goes', async () => {
    const id = await pmCreates(w.pm, 'Mixed');
    await assign(w.admin, w.p1, w.s1, id);
    await assign(w.admin, w.p2, w.s2, id);
    await expectVisible(w.pm, id); // normal project scope (P1)
    await unassign(w.admin, w.p1, w.s1, id);
    await expectHidden(w.pm, id);
    await unassign(w.admin, w.p2, w.s2, id);
    await expectVisible(w.pm, id);
  });

  it('re-assigned after re-visibility to a project the creator is not on: hidden again', async () => {
    const id = await pmCreates(w.pm, 'Again');
    await assign(w.admin, w.p2, w.s2, id);
    await unassign(w.admin, w.p2, w.s2, id);
    await expectVisible(w.pm, id);
    await assign(w.admin, w.p3, w.s3, id);
    await expectHidden(w.pm, id);
  });
});

// ─── No extra privileges ──────────────────────────────────────────────────────

describe('re-visibility grants no extra privileges', () => {
  it('PM creator cannot PATCH, deactivate, assign elsewhere, unassign or see wages; row unchanged', async () => {
    const id = await pmCreates(w.pm, 'ReadOnly');
    await assign(w.admin, w.p2, w.s2, id);
    const setWage = await req(w.admin, 'PATCH', `/workers/${id}`, { dailyWage: 150, currency: 'KES', trade: 'Mason' });
    expect(setWage.statusCode).toBe(200);
    await unassign(w.admin, w.p2, w.s2, id);
    await expectVisible(w.pm, id);

    const before = await prisma.worker.findUniqueOrThrow({ where: { id } });

    expect((await req(w.pm, 'PATCH', `/workers/${id}`, { trade: 'Changed' })).statusCode).toBe(404);
    expect((await req(w.pm, 'PATCH', `/workers/${id}`, { dailyWage: 999 })).statusCode).toBe(404);
    expect((await req(w.pm, 'DELETE', `/workers/${id}`)).statusCode).toBe(403);
    expect((await req(w.pm, 'POST', `/projects/${w.p2}/sites/${w.s2}/workers`, { workerId: id })).statusCode).toBe(403);
    expect((await req(w.pm, 'POST', `/projects/${w.p3}/sites/${w.s3}/workers`, { workerId: id })).statusCode).toBe(403);
    expect((await req(w.pm, 'DELETE', `/projects/${w.p2}/sites/${w.s2}/workers/${id}`)).statusCode).toBe(403);

    const detail = (await req(w.pm, 'GET', `/workers/${id}`)).json().worker;
    expect(detail).not.toHaveProperty('dailyWage');
    expect(detail).not.toHaveProperty('currency');
    const listed = ((await req(w.pm, 'GET', '/workers')).json().workers as Array<Record<string, unknown>>)
      .find((x) => x['id'] === id)!;
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('dailyWage');
    expect(listed).not.toHaveProperty('currency');

    const after = await prisma.worker.findUniqueOrThrow({ where: { id } });
    expect(after).toEqual(before);
    expect(after.isActive).toBe(true);
    expect(after.trade).toBe('Mason');
    expect(Number(after.dailyWage)).toBe(150);
    expect(await prisma.workerAssignment.count({ where: { workerId: id, removedAt: null } })).toBe(0);

    // Finance keeps seeing the wage.
    expect((await req(w.finance, 'GET', `/workers/${id}`)).json().worker.dailyWage).toBeDefined();
  });

  it('supervisor creator cannot PATCH, deactivate, assign or see wages; row unchanged', async () => {
    const id = await insertCreatedBy(w.cidA, w.sup.id, 'SupReadOnly');
    await assign(w.admin, w.p2, w.s2, id);
    expect((await req(w.admin, 'PATCH', `/workers/${id}`, { dailyWage: 90, currency: 'KES' })).statusCode).toBe(200);
    await unassign(w.admin, w.p2, w.s2, id);
    await expectVisible(w.sup, id);

    const before = await prisma.worker.findUniqueOrThrow({ where: { id } });

    expect((await req(w.sup, 'PATCH', `/workers/${id}`, { trade: 'X' })).statusCode).toBe(403);
    expect((await req(w.sup, 'PATCH', `/workers/${id}`, { dailyWage: 1 })).statusCode).toBe(403);
    expect((await req(w.sup, 'DELETE', `/workers/${id}`)).statusCode).toBe(403);
    expect((await req(w.sup, 'POST', `/projects/${w.p1}/sites/${w.s1}/workers`, { workerId: id })).statusCode).toBe(403);
    expect((await req(w.sup, 'POST', `/projects/${w.p2}/sites/${w.s2}/workers`, { workerId: id })).statusCode).toBe(403);

    const detail = (await req(w.sup, 'GET', `/workers/${id}`)).json().worker;
    expect(detail).not.toHaveProperty('dailyWage');
    expect(detail).not.toHaveProperty('currency');

    expect(await prisma.worker.findUniqueOrThrow({ where: { id } })).toEqual(before);
    expect(await prisma.workerAssignment.count({ where: { workerId: id, removedAt: null } })).toBe(0);
  });
});

// ─── Context binding ──────────────────────────────────────────────────────────

describe('creator without an authorised context', () => {
  it('PM who loses every project membership: hidden even with no active assignment', async () => {
    const id = await pmCreates(w.pmLose, 'PmLose');
    await assign(w.admin, w.p2, w.s2, id);
    await unassign(w.admin, w.p2, w.s2, id);
    await expectVisible(w.pmLose, id);

    const rm = await req(w.admin, 'DELETE', `/projects/${w.p1}/members/${w.pmLose.id}`);
    expect(rm.statusCode).toBe(204);
    await expectHidden(w.pmLose, id);
  });

  it('supervisor who loses every site membership: hidden even with no active assignment', async () => {
    const id = await insertCreatedBy(w.cidA, w.supLose.id, 'SupLose');
    await assign(w.admin, w.p2, w.s2, id);
    await unassign(w.admin, w.p2, w.s2, id);
    await expectVisible(w.supLose, id);

    const rm = await req(w.admin, 'DELETE', `/projects/${w.p1}/members/${w.supLose.id}`);
    expect(rm.statusCode).toBe(204);
    await expectHidden(w.supLose, id);
  });
});

// ─── Nobody else ──────────────────────────────────────────────────────────────

describe('other users never gain visibility', () => {
  it('other PMs and supervisors in the same company: never visible, before or after removal', async () => {
    const pmRow = await pmCreates(w.pm, 'PeerPm');
    const supRow = await insertCreatedBy(w.cidA, w.sup.id, 'PeerSup');
    for (const id of [pmRow, supRow]) {
      await assign(w.admin, w.p2, w.s2, id);
      for (const u of [w.pm2, w.sup2]) await expectHidden(u, id);
      await unassign(w.admin, w.p2, w.s2, id);
      for (const u of [w.pm2, w.sup2]) await expectHidden(u, id);
    }
    // Each creator sees only their own row.
    await expectVisible(w.pm, pmRow);
    await expectHidden(w.pm, supRow);
    await expectVisible(w.sup, supRow);
    await expectHidden(w.sup, pmRow);
  });

  it('creators in another company: never visible, and their own rows stay out of company A', async () => {
    const aRow = await pmCreates(w.pm, 'TenantA');
    await assign(w.admin, w.p2, w.s2, aRow);
    await unassign(w.admin, w.p2, w.s2, aRow);
    for (const u of [w.pmB, w.supB]) await expectHidden(u, aRow);

    // Row in company A attributed to company B's PM / supervisor (e.g. a moved user).
    for (const creator of [w.pmB, w.supB]) {
      const id = await insertCreatedBy(w.cidA, creator.id, 'Foreign');
      await assign(w.admin, w.p2, w.s2, id);
      await unassign(w.admin, w.p2, w.s2, id);
      await expectHidden(creator, id);
    }

    // Company B's own worker goes through the same flow in B: visible to its
    // creator, never to company A.
    const bRow = await pmCreates(w.pmB, 'TenantB');
    await assign(w.adminB, w.pb, w.sb, bRow);
    await unassign(w.adminB, w.pb, w.sb, bRow);
    await expectVisible(w.pmB, bRow);
    for (const u of [w.pm, w.pm2, w.sup, w.sup2, w.admin]) await expectHidden(u, bRow);
  });
});

// ─── Supervisor creator ───────────────────────────────────────────────────────

describe('supervisor creator: the same flow with sites', () => {
  it('assigned to a site the supervisor is not on: hidden; all removed: visible', async () => {
    const id = await insertCreatedBy(w.cidA, w.sup.id, 'SupAway');
    await expectVisible(w.sup, id);
    await assign(w.admin, w.p2, w.s2, id);
    await expectHidden(w.sup, id);
    await unassign(w.admin, w.p2, w.s2, id);
    await expectVisible(w.sup, id);
    expect((await req(w.sup, 'GET', `/workers/${id}`)).json().worker.assignments).toEqual([]);
  });

  it('two out-of-scope sites: removing one keeps it hidden; removing both shows it', async () => {
    const id = await insertCreatedBy(w.cidA, w.sup.id, 'SupTwoAway');
    await assign(w.admin, w.p2, w.s2, id);
    await assign(w.admin, w.p3, w.s3, id);
    await unassign(w.admin, w.p3, w.s3, id);
    await expectHidden(w.sup, id);
    await unassign(w.admin, w.p2, w.s2, id);
    await expectVisible(w.sup, id);
  });

  it('own site + other site: removing the own-site one hides it until the other goes', async () => {
    const id = await insertCreatedBy(w.cidA, w.sup.id, 'SupMixed');
    await assign(w.admin, w.p1, w.s1, id);
    await assign(w.admin, w.p2, w.s2, id);
    await expectVisible(w.sup, id); // normal site scope (S1)
    await unassign(w.admin, w.p1, w.s1, id);
    await expectHidden(w.sup, id);
    await unassign(w.admin, w.p2, w.s2, id);
    await expectVisible(w.sup, id);
  });
});
