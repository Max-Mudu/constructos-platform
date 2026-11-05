/**
 * S10 regression — :siteId must belong to :projectId (and the actor's company)
 * on every route mounted under /api/v1/projects/:projectId/sites/:siteId/...
 *
 * requireProjectAccess validates the project (company + membership). This suite
 * proves that a project member cannot smuggle another project's — or another
 * company's — site id into their own project's URL, for reads and for writes,
 * and that rejected writes leave no rows behind.
 */
import { randomUUID } from 'crypto';
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
  createTestContractor,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

// ─── World ────────────────────────────────────────────────────────────────────
//
// Company A
//   P1 ── S1 (worker W assigned, supervisor assigned), S2 (sibling site)
//   P2 ── X  (same company, different project; W also assigned here under P2)
// Company B
//   Q  ── Y  (foreign tenant)

interface World {
  admin:      TestUser;   // company_admin, company A
  finance:    TestUser;   // finance_officer, company A
  pm:         TestUser;   // project_manager, member of P1
  outsiderPm: TestUser;   // project_manager, company A, NOT a member of P1
  supervisor: TestUser;   // site_supervisor, member of P1 scoped to S1
  p1: string; s1: string; s2: string;
  p2: string; x: string;
  y: string;
  workerId: string;
  contractorId: string;
}

let w: World;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'spb-a');
  const b = await createTestCompany(app, 'spb-b');
  const cid = a.company.id;

  const p1 = await createTestProject(cid, 'P1');
  const s1 = await createTestSite(cid, p1.id, 'S1');
  const s2 = await createTestSite(cid, p1.id, 'S2');
  const p2 = await createTestProject(cid, 'P2');
  const x  = await createTestSite(cid, p2.id, 'X');
  const q  = await createTestProject(b.company.id, 'Q');
  const y  = await createTestSite(b.company.id, q.id, 'Y');

  const finance    = await createTestUser(app, cid, 'finance_officer', 'spb-fin', { canViewFinance: true });
  const pm         = await createTestUser(app, cid, 'project_manager', 'spb-pm');
  const outsiderPm = await createTestUser(app, cid, 'project_manager', 'spb-out');
  const supervisor = await createTestUser(app, cid, 'site_supervisor', 'spb-sup');
  await assignUserToProject(cid, p1.id, pm.id);
  await assignUserToProject(cid, p1.id, supervisor.id, s1.id);
  // outsiderPm is a member of P2 only
  await assignUserToProject(cid, p2.id, outsiderPm.id);

  const worker = await createTestWorker(cid);
  await assignWorkerToSite(cid, p1.id, s1.id, worker.id, a.admin.id);
  await assignWorkerToSite(cid, p2.id, x.id,  worker.id, a.admin.id);

  const contractor = await createTestContractor(cid);

  // Data on the foreign sites that must never be reachable through a P1 URL
  await prisma.siteInventory.create({
    data: { companyId: cid, siteId: x.id, materialName: 'Cement-X', unitOfMeasure: 'bags', currentQuantity: 10 },
  });
  await prisma.siteInventory.create({
    data: { companyId: b.company.id, siteId: y.id, materialName: 'Cement-Y', unitOfMeasure: 'bags', currentQuantity: 10 },
  });

  w = {
    admin: a.admin, finance, pm, outsiderPm, supervisor,
    p1: p1.id, s1: s1.id, s2: s2.id,
    p2: p2.id, x: x.id,
    y: y.id,
    workerId: worker.id,
    contractorId: contractor.id,
  };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

// ─── Endpoint catalogue ───────────────────────────────────────────────────────

type CountFn = (siteId: string) => Promise<number>;

interface Endpoint {
  name: string;
  method: 'GET' | 'POST';
  suffix: string;
  ok: number;
  payload?: () => Record<string, unknown>;
  count?: CountFn;           // rows on a site, for POST endpoints
  financeCanView?: boolean;  // finance_officer is in the route's VIEW_ROLES
}

let seq = 0;
const nextDate = () => {
  seq += 1;
  const d = new Date(Date.UTC(2026, 0, 1 + seq));
  return d.toISOString().slice(0, 10);
};

const ENDPOINTS: Endpoint[] = [
  { name: 'GET labour',            method: 'GET',  suffix: 'labour',            ok: 200, financeCanView: true },
  {
    name: 'POST labour', method: 'POST', suffix: 'labour', ok: 201,
    payload: () => ({ workerId: w.workerId, date: nextDate(), hoursWorked: 8, dailyRate: 1000, currency: 'USD' }),
    count: (siteId) => prisma.labourEntry.count({ where: { siteId } }),
  },
  { name: 'GET attendance',        method: 'GET',  suffix: 'attendance',        ok: 200, financeCanView: true },
  {
    name: 'POST attendance', method: 'POST', suffix: 'attendance', ok: 201,
    payload: () => ({ workerId: w.workerId, date: nextDate(), status: 'present' }),
    count: (siteId) => prisma.attendanceRecord.count({ where: { siteId } }),
  },
  { name: 'GET targets',           method: 'GET',  suffix: 'targets',           ok: 200, financeCanView: true },
  {
    name: 'POST targets', method: 'POST', suffix: 'targets', ok: 201,
    payload: () => ({ date: nextDate(), description: 'Lay blocks', targetValue: 100, targetUnit: 'blocks' }),
    count: (siteId) => prisma.dailyTarget.count({ where: { siteId } }),
  },
  { name: 'GET deliveries',        method: 'GET',  suffix: 'deliveries',        ok: 200, financeCanView: true },
  {
    name: 'POST deliveries', method: 'POST', suffix: 'deliveries', ok: 201,
    payload: () => ({
      supplierName: 'Acme', deliveryDate: nextDate(), itemDescription: 'Cement',
      unitOfMeasure: 'bags', quantityOrdered: 10, quantityDelivered: 10, receivedById: w.pm.id,
      // Explicit: the DB column is NOT NULL (migration) although schema.prisma marks it optional.
      acceptanceStatus: 'accepted',
    }),
    count: (siteId) => prisma.deliveryRecord.count({ where: { siteId } }),
  },
  { name: 'GET inventory',         method: 'GET',  suffix: 'inventory',         ok: 200, financeCanView: true },
  { name: 'GET schedule/tasks',    method: 'GET',  suffix: 'schedule/tasks',    ok: 200, financeCanView: true },
  {
    name: 'POST schedule/tasks', method: 'POST', suffix: 'schedule/tasks', ok: 201,
    payload: () => ({ contractorId: w.contractorId, title: `Task ${++seq}` }),
    count: (siteId) => prisma.scheduleTask.count({ where: { siteId } }),
  },
  { name: 'GET schedule/packages', method: 'GET',  suffix: 'schedule/packages', ok: 200, financeCanView: true },
  {
    name: 'POST schedule/packages', method: 'POST', suffix: 'schedule/packages', ok: 201,
    payload: () => ({ contractorId: w.contractorId, name: `Package ${++seq}` }),
    count: (siteId) => prisma.workPackage.count({ where: { siteId } }),
  },
  { name: 'GET schedule/summary',  method: 'GET',  suffix: 'schedule/summary',  ok: 200, financeCanView: true },
  // Already validated in their services — included to pin behaviour.
  { name: 'GET site workers',      method: 'GET',  suffix: 'workers',           ok: 200, financeCanView: true },
];

const GETS  = ENDPOINTS.filter((e) => e.method === 'GET');
const POSTS = ENDPOINTS.filter((e) => e.method === 'POST');

function call(e: Endpoint, user: TestUser, projectId: string, siteId: string) {
  return app.inject({
    method: e.method,
    url: `/api/v1/projects/${projectId}/sites/${siteId}/${e.suffix}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    ...(e.payload && { payload: e.payload() }),
  });
}

// Bad-site variants, all routed through the PM's own project P1
const BAD_SITES: Array<[string, () => string]> = [
  ['site of another project in the same company', () => w.x],
  ['site of another company',                     () => w.y],
  ['nonexistent site',                            () => randomUUID()],
];

// ─── Positive controls ────────────────────────────────────────────────────────

describe('own project + own site — normal success', () => {
  it.each(ENDPOINTS.map((e) => [e.name, e] as const))('%s as project member → success', async (_n, e) => {
    const before = e.count ? await e.count(w.s1) : 0;
    const res = await call(e, w.pm, w.p1, w.s1);
    expect(res.statusCode).toBe(e.ok);
    if (e.count) expect(await e.count(w.s1)).toBe(before + 1);
  });

  it.each(GETS.map((e) => [e.name, e] as const))('%s as company_admin → 200', async (_n, e) => {
    const res = await call(e, w.admin, w.p1, w.s1);
    expect(res.statusCode).toBe(200);
  });

  it.each(GETS.filter((e) => e.financeCanView).map((e) => [e.name, e] as const))(
    '%s as finance_officer → 200', async (_n, e) => {
      const res = await call(e, w.finance, w.p1, w.s1);
      expect(res.statusCode).toBe(200);
    },
  );

  it.each(POSTS.map((e) => [e.name, e] as const))('%s as company_admin → 201', async (_n, e) => {
    const before = await e.count!(w.s1);
    const res = await call(e, w.admin, w.p1, w.s1);
    expect(res.statusCode).toBe(201);
    expect(await e.count!(w.s1)).toBe(before + 1);
  });

  it('company_admin can still use P2 with its own site X', async () => {
    const res = await call(GETS[0]!, w.admin, w.p2, w.x);
    expect(res.statusCode).toBe(200);
  });

  it('site_supervisor on own assigned site S1 → GET labour 200', async () => {
    const res = await call(GETS[0]!, w.supervisor, w.p1, w.s1);
    expect(res.statusCode).toBe(200);
  });
});

// ─── Mismatched site/project — reads ─────────────────────────────────────────

describe.each(BAD_SITES)('own project + %s — reads', (_label, siteOf) => {
  it.each(GETS.map((e) => [e.name, e] as const))('%s as project member → 404', async (_n, e) => {
    const res = await call(e, w.pm, w.p1, siteOf());
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
  });

  it.each(GETS.map((e) => [e.name, e] as const))('%s as company_admin → 404', async (_n, e) => {
    const res = await call(e, w.admin, w.p1, siteOf());
    expect(res.statusCode).toBe(404);
  });
});

describe('inventory read leak', () => {
  it('P1 member cannot list inventory of a same-company site in P2 via a P1 URL', async () => {
    const res = await call(GETS.find((e) => e.suffix === 'inventory')!, w.pm, w.p1, w.x);
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain('Cement-X');
  });

  it('P1 member cannot list inventory of another company\'s site via a P1 URL', async () => {
    const res = await call(GETS.find((e) => e.suffix === 'inventory')!, w.pm, w.p1, w.y);
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain('Cement-Y');
  });
});

// ─── Mismatched site/project — writes create nothing ─────────────────────────

describe.each(BAD_SITES)('own project + %s — writes', (_label, siteOf) => {
  it.each(POSTS.map((e) => [e.name, e] as const))('%s as project member → 404, no row', async (_n, e) => {
    const siteId = siteOf();
    const before = await e.count!(siteId);
    const res = await call(e, w.pm, w.p1, siteId);
    expect(res.statusCode).toBe(404);
    expect(await e.count!(siteId)).toBe(before);
  });

  it.each(POSTS.map((e) => [e.name, e] as const))('%s as company_admin → 404, no row', async (_n, e) => {
    const siteId = siteOf();
    const before = await e.count!(siteId);
    const res = await call(e, w.admin, w.p1, siteId);
    expect(res.statusCode).toBe(404);
    expect(await e.count!(siteId)).toBe(before);
  });
});

describe('no cross-binding rows anywhere', () => {
  it('no P1-owned row references a site outside P1', async () => {
    const inP1 = { projectId: w.p1, siteId: { notIn: [w.s1, w.s2] } };
    expect(await prisma.labourEntry.count({ where: inP1 })).toBe(0);
    expect(await prisma.attendanceRecord.count({ where: inP1 })).toBe(0);
    expect(await prisma.dailyTarget.count({ where: inP1 })).toBe(0);
    expect(await prisma.deliveryRecord.count({ where: inP1 })).toBe(0);
    expect(await prisma.scheduleTask.count({ where: inP1 })).toBe(0);
    expect(await prisma.workPackage.count({ where: inP1 })).toBe(0);
  });
});

describe('response shape does not reveal which binding failed', () => {
  it('same-company/other-project, other-company and nonexistent sites give identical bodies', async () => {
    const e = GETS[0]!;
    const bodies = await Promise.all(
      BAD_SITES.map(async ([, siteOf]) => (await call(e, w.pm, w.p1, siteOf())).json()),
    );
    expect(bodies[0]).toEqual({ error: 'Site not found', code: 'NOT_FOUND' });
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });
});

// ─── Existing semantics preserved ─────────────────────────────────────────────

describe('site_supervisor scoped to S1 using sibling site S2 of the same project', () => {
  // Current behaviour (service-level getAccessibleSiteIds scoping): 404.
  it.each(GETS.filter((e) => e.suffix !== 'workers').map((e) => [e.name, e] as const))(
    '%s → 404', async (_n, e) => {
      const res = await call(e, w.supervisor, w.p1, w.s2);
      expect(res.statusCode).toBe(404);
    },
  );

  it('POST targets on S2 → 404, no row', async () => {
    const e = POSTS.find((p) => p.suffix === 'targets')!;
    const before = await e.count!(w.s2);
    const res = await call(e, w.supervisor, w.p1, w.s2);
    expect(res.statusCode).toBe(404);
    expect(await e.count!(w.s2)).toBe(before);
  });
});

describe('non-member project_manager — 403 unchanged', () => {
  it.each(ENDPOINTS.map((e) => [e.name, e] as const))('%s on P1/S1 → 403', async (_n, e) => {
    const before = e.count ? await e.count(w.s1) : 0;
    const res = await call(e, w.outsiderPm, w.p1, w.s1);
    expect(res.statusCode).toBe(403);
    if (e.count) expect(await e.count(w.s1)).toBe(before);
  });

  it('membership is checked before the site binding (foreign site still → 403)', async () => {
    const res = await call(GETS[0]!, w.outsiderPm, w.p1, w.y);
    expect(res.statusCode).toBe(403);
  });

  it('project of another company with own site → 404 Project (unchanged)', async () => {
    const otherProject = await prisma.jobSite.findUniqueOrThrow({ where: { id: w.y }, select: { projectId: true } });
    const res = await call(GETS[0]!, w.pm, otherProject.projectId, w.s1);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Project not found', code: 'NOT_FOUND' });
  });
});
