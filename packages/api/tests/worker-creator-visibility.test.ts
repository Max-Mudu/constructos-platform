/**
 * Creator visibility for workers (read only).
 *
 * A project_manager or site_supervisor may SEE (GET /workers, GET /workers/:id)
 * a worker they registered while it has no active assignment, provided they
 * still hold an active project (PM) or site (supervisor) membership in their
 * own company. It grants nothing else: PATCH / DELETE / assignment / wage
 * visibility and wage writes are decided exactly as before.
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

// Company A: P1 (S1, S1b), P2 (S2)
//   pm      project_manager (canViewFinance) member of P1  — the creator
//   pm2     project_manager member of P1                    — same-company peer
//   sup     site_supervisor on P1/S1                        — creator (rows inserted directly:
//                                                             supervisors cannot POST /workers)
//   sup2    site_supervisor on P1/S1                        — same-company peer
//   supProj site_supervisor with a project-level membership only (no site)
//   worker  worker-role user
// Company B: PB (SB); pmB project_manager member of PB
interface World {
  cidA: string; cidB: string;
  admin: TestUser; finance: TestUser; pm: TestUser; pm2: TestUser;
  sup: TestUser; sup2: TestUser; supProj: TestUser; workerUser: TestUser; pmB: TestUser;
  p1: string; s1: string; p2: string; s2: string;
}
let w: World;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'worker-creator-a');
  const cid = a.company.id;
  const finance    = await createTestUser(app, cid, 'finance_officer', 'wc-fo');
  const pm         = await createTestUser(app, cid, 'project_manager', 'wc-pm', { canViewFinance: true });
  const pm2        = await createTestUser(app, cid, 'project_manager', 'wc-pm2', { canViewFinance: true });
  const sup        = await createTestUser(app, cid, 'site_supervisor', 'wc-sup');
  const sup2       = await createTestUser(app, cid, 'site_supervisor', 'wc-sup2');
  const supProj    = await createTestUser(app, cid, 'site_supervisor', 'wc-supproj');
  const workerUser = await createTestUser(app, cid, 'worker', 'wc-worker');

  const p1 = await createTestProject(cid, 'P1');
  const s1 = await createTestSite(cid, p1.id, 'S1');
  const p2 = await createTestProject(cid, 'P2');
  const s2 = await createTestSite(cid, p2.id, 'S2');
  await assignUserToProject(cid, p1.id, pm.id);
  await assignUserToProject(cid, p1.id, pm2.id);
  await assignUserToProject(cid, p1.id, sup.id, s1.id);
  await assignUserToProject(cid, p1.id, sup2.id, s1.id);
  await assignUserToProject(cid, p1.id, supProj.id);

  const b = await createTestCompany(app, 'worker-creator-b');
  const pmB = await createTestUser(app, b.company.id, 'project_manager', 'wc-pmb');
  const pb = await createTestProject(b.company.id, 'PB');
  await createTestSite(b.company.id, pb.id, 'SB');
  await assignUserToProject(b.company.id, pb.id, pmB.id);

  w = {
    cidA: cid, cidB: b.company.id,
    admin: a.admin, finance, pm, pm2, sup, sup2, supProj, workerUser, pmB,
    p1: p1.id, s1: s1.id, p2: p2.id, s2: s2.id,
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

async function listIds(user: TestUser, query = ''): Promise<string[]> {
  const res = await req(user, 'GET', `/workers${query}`);
  expect(res.statusCode).toBe(200);
  return (res.json().workers as Array<{ id: string }>).map((x) => x.id);
}

/** PM registers a worker through the API (the real creation path). */
async function pmCreates(user: TestUser, firstName: string): Promise<string> {
  const res = await req(user, 'POST', '/workers', { firstName, lastName: 'Creator' });
  expect(res.statusCode).toBe(201);
  return res.json().worker.id as string;
}

/** Worker row recorded as created by `creatorId` (supervisors cannot POST /workers). */
async function insertCreatedBy(companyId: string, creatorId: string, firstName: string): Promise<string> {
  const row = await createTestWorker(companyId, { firstName });
  await prisma.worker.update({ where: { id: row.id }, data: { createdById: creatorId } });
  return row.id;
}

// ─── Creator sees their unassigned worker ─────────────────────────────────────

describe('creator sees the worker they registered', () => {
  it('POST /workers records the creator', async () => {
    const id = await pmCreates(w.pm, 'Recorded');
    const row = await prisma.worker.findUniqueOrThrow({ where: { id } });
    expect(row.createdById).toBe(w.pm.id);
    expect(row.companyId).toBe(w.cidA);
  });

  it('PM creator: listed and readable while unassigned', async () => {
    const id = await pmCreates(w.pm, 'Mine');
    expect(await listIds(w.pm)).toContain(id);
    const res = await req(w.pm, 'GET', `/workers/${id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().worker.id).toBe(id);
    expect(res.json().worker.assignments).toEqual([]);
  });

  it('supervisor creator: listed and readable while unassigned', async () => {
    const id = await insertCreatedBy(w.cidA, w.sup.id, 'SupMine');
    expect(await listIds(w.sup)).toContain(id);
    expect((await req(w.sup, 'GET', `/workers/${id}`)).statusCode).toBe(200);
  });

  it('list filters still narrow: ?projectId= / ?siteId= do not include unassigned rows', async () => {
    const id = await pmCreates(w.pm, 'Filtered');
    expect(await listIds(w.pm, `?projectId=${w.p1}`)).not.toContain(id);
    expect(await listIds(w.pm, `?siteId=${w.s1}`)).not.toContain(id);
  });

  it('a legacy row with no recorded creator stays hidden', async () => {
    const legacy = await createTestWorker(w.cidA, { firstName: 'Legacy' });
    expect(await listIds(w.pm)).not.toContain(legacy.id);
    expect((await req(w.pm, 'GET', `/workers/${legacy.id}`)).statusCode).toBe(404);
  });
});

// ─── Nobody else gains visibility ─────────────────────────────────────────────

describe('other users do not gain visibility', () => {
  it('another PM in the same company does not see it', async () => {
    const id = await pmCreates(w.pm, 'NotForPm2');
    expect(await listIds(w.pm2)).not.toContain(id);
    expect((await req(w.pm2, 'GET', `/workers/${id}`)).statusCode).toBe(404);
  });

  it('another supervisor in the same company does not see it', async () => {
    const pmId = await pmCreates(w.pm, 'NotForSup');
    const supId = await insertCreatedBy(w.cidA, w.sup.id, 'NotForSup2');
    for (const id of [pmId, supId]) {
      expect(await listIds(w.sup2)).not.toContain(id);
      expect((await req(w.sup2, 'GET', `/workers/${id}`)).statusCode).toBe(404);
    }
    expect(await listIds(w.sup)).not.toContain(pmId);
  });

  it('cross-tenant: a creator in another company does not see it', async () => {
    // Row in company A attributed to company B's PM (e.g. a user later moved).
    const id = await insertCreatedBy(w.cidA, w.pmB.id, 'CrossTenant');
    expect(await listIds(w.pmB)).not.toContain(id);
    expect((await req(w.pmB, 'GET', `/workers/${id}`)).statusCode).toBe(404);
    // And company B's own created worker is invisible to company A's PM.
    const bId = await pmCreates(w.pmB, 'BeeOwn');
    expect(await listIds(w.pmB)).toContain(bId);
    expect(await listIds(w.pm)).not.toContain(bId);
    expect((await req(w.pm, 'GET', `/workers/${bId}`)).statusCode).toBe(404);
    expect((await req(w.admin, 'GET', `/workers/${bId}`)).statusCode).toBe(404);
  });

  it('worker role still cannot list or read workers', async () => {
    const id = await pmCreates(w.pm, 'NotForWorker');
    expect((await req(w.workerUser, 'GET', '/workers')).statusCode).toBe(403);
    expect((await req(w.workerUser, 'GET', `/workers/${id}`)).statusCode).toBe(403);
  });

  it('company_admin and finance_officer still see every company worker', async () => {
    const id = await pmCreates(w.pm, 'AdminSees');
    expect(await listIds(w.admin)).toContain(id);
    expect(await listIds(w.finance)).toContain(id);
    expect((await req(w.admin, 'GET', `/workers/${id}`)).statusCode).toBe(200);
    expect((await req(w.finance, 'GET', `/workers/${id}`)).statusCode).toBe(200);
  });
});

// ─── No extra privileges ──────────────────────────────────────────────────────

describe('creating a worker grants no extra privileges', () => {
  it('creator cannot PATCH or DELETE the unassigned worker; row unchanged', async () => {
    const id = await pmCreates(w.pm, 'NoEdit');
    const patch = await req(w.pm, 'PATCH', `/workers/${id}`, { trade: 'Changed' });
    expect(patch.statusCode).toBe(404);
    const wage = await req(w.pm, 'PATCH', `/workers/${id}`, { dailyWage: 999 });
    expect(wage.statusCode).toBe(404);
    expect((await req(w.pm, 'DELETE', `/workers/${id}`)).statusCode).toBe(403);
    const row = await prisma.worker.findUniqueOrThrow({ where: { id } });
    expect(row.trade).toBeNull();
    expect(row.dailyWage).toBeNull();
    expect(row.isActive).toBe(true);
  });

  it('PM still cannot set a wage on create (403 FINANCE_ACCESS_DENIED)', async () => {
    const res = await req(w.pm, 'POST', '/workers', { firstName: 'Wage', lastName: 'Try', dailyWage: 50 });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FINANCE_ACCESS_DENIED');
  });

  it('supervisor still cannot create, assign or edit', async () => {
    expect((await req(w.sup, 'POST', '/workers', { firstName: 'S', lastName: 'Try' })).statusCode).toBe(403);
    const id = await insertCreatedBy(w.cidA, w.sup.id, 'SupNoAssign');
    const assign = await req(w.sup, 'POST', `/projects/${w.p1}/sites/${w.s1}/workers`, { workerId: id });
    expect(assign.statusCode).toBe(403);
    expect((await req(w.sup, 'PATCH', `/workers/${id}`, { trade: 'X' })).statusCode).toBe(403);
    expect(await prisma.workerAssignment.count({ where: { workerId: id } })).toBe(0);
  });

  it('PM assignment rules are unchanged: may assign on a member project, not on a non-member one', async () => {
    const id = await pmCreates(w.pm, 'AssignRules');
    expect((await req(w.pm, 'POST', `/projects/${w.p2}/sites/${w.s2}/workers`, { workerId: id })).statusCode).toBe(403);
    expect((await req(w.pm, 'POST', `/projects/${w.p1}/sites/${w.s1}/workers`, { workerId: id })).statusCode).toBe(201);
  });

  it('wage fields stay hidden from the creator even after an admin sets a wage', async () => {
    const id = await pmCreates(w.pm, 'WageHidden');
    const set = await req(w.admin, 'PATCH', `/workers/${id}`, { dailyWage: 120, currency: 'KES' });
    expect(set.statusCode).toBe(200);
    expect(set.json().worker.dailyWage).toBeDefined();

    const detail = (await req(w.pm, 'GET', `/workers/${id}`)).json().worker;
    expect(detail).not.toHaveProperty('dailyWage');
    expect(detail).not.toHaveProperty('currency');
    const listed = ((await req(w.pm, 'GET', '/workers')).json().workers as Array<Record<string, unknown>>)
      .find((x) => x['id'] === id)!;
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('dailyWage');
    expect(listed).not.toHaveProperty('currency');

    const supId = await insertCreatedBy(w.cidA, w.sup.id, 'SupWageHidden');
    await prisma.worker.update({ where: { id: supId }, data: { dailyWage: 80 } });
    const supDetail = (await req(w.sup, 'GET', `/workers/${supId}`)).json().worker;
    expect(supDetail).not.toHaveProperty('dailyWage');
    expect(supDetail).not.toHaveProperty('currency');

    // Finance roles keep seeing it.
    expect((await req(w.finance, 'GET', `/workers/${id}`)).json().worker.dailyWage).toBeDefined();
  });
});

// ─── Context binding ──────────────────────────────────────────────────────────

describe('context binding', () => {
  it('once assigned to a project the creator is not on, the creator stops seeing it', async () => {
    const id = await pmCreates(w.pm, 'MovedAway');
    await assignWorkerToSite(w.cidA, w.p2, w.s2, id, w.admin.id);
    expect(await listIds(w.pm)).not.toContain(id);
    expect((await req(w.pm, 'GET', `/workers/${id}`)).statusCode).toBe(404);
  });

  it('once assigned to the creator\'s own project, normal scope keeps it visible (and editable as before)', async () => {
    const id = await pmCreates(w.pm, 'StaysHome');
    await assignWorkerToSite(w.cidA, w.p1, w.s1, id, w.admin.id);
    expect(await listIds(w.pm)).toContain(id);
    expect((await req(w.pm, 'PATCH', `/workers/${id}`, { trade: 'Mason' })).statusCode).toBe(200);
  });

  it('supervisor creator: assigned to another site → hidden', async () => {
    const id = await insertCreatedBy(w.cidA, w.sup.id, 'SupMovedAway');
    await assignWorkerToSite(w.cidA, w.p2, w.s2, id, w.admin.id);
    expect(await listIds(w.sup)).not.toContain(id);
    expect((await req(w.sup, 'GET', `/workers/${id}`)).statusCode).toBe(404);
  });

  it('supervisor without any site membership does not see workers they created', async () => {
    const id = await insertCreatedBy(w.cidA, w.supProj.id, 'NoSiteCtx');
    expect(await listIds(w.supProj)).not.toContain(id);
    expect((await req(w.supProj, 'GET', `/workers/${id}`)).statusCode).toBe(404);
  });

  it('PM who loses every project membership stops seeing it; regains it when re-added', async () => {
    const id = await pmCreates(w.pm, 'LostContext');
    await prisma.projectMember.updateMany({ where: { userId: w.pm.id }, data: { removedAt: new Date() } });
    try {
      expect(await listIds(w.pm)).not.toContain(id);
      expect((await req(w.pm, 'GET', `/workers/${id}`)).statusCode).toBe(404);
    } finally {
      await prisma.projectMember.updateMany({ where: { userId: w.pm.id }, data: { removedAt: null } });
    }
    expect(await listIds(w.pm)).toContain(id);
  });

  it('a membership on another company\'s project is not a valid context', async () => {
    const id = await pmCreates(w.pm, 'ForeignCtx');
    await prisma.projectMember.updateMany({ where: { userId: w.pm.id }, data: { removedAt: new Date() } });
    const pb = await prisma.project.findFirstOrThrow({ where: { companyId: w.cidB } });
    await assignUserToProject(w.cidB, pb.id, w.pm.id);
    try {
      expect(await listIds(w.pm)).not.toContain(id);
      expect((await req(w.pm, 'GET', `/workers/${id}`)).statusCode).toBe(404);
    } finally {
      await prisma.projectMember.deleteMany({ where: { userId: w.pm.id, projectId: pb.id } });
      await prisma.projectMember.updateMany({ where: { userId: w.pm.id }, data: { removedAt: null } });
    }
  });
});
