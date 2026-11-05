/**
 * Wage visibility — individual pay rates (LabourEntry.dailyRate, Worker.dailyWage)
 * and their currency are FINANCIAL fields.
 *
 * Visible to: super_admin / company_admin / finance_officer (company-wide) and
 * project_manager with canViewFinance=true (member projects only). Everyone else
 * allowed to read labour/worker data gets the non-financial fields only — the
 * financial keys are omitted (never sent as 0/null).
 *
 * Responses to a non-finance writer never echo the financial fields. Who may
 * CHOOSE a rate/wage is covered by wage-write-policy.test.ts: non-finance labour
 * writers get the rate derived from the worker (submitted values ignored), and
 * worker wage fields need financial authorisation.
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
  createTestLabourEntry,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

// ─── World ────────────────────────────────────────────────────────────────────
//
// Company A
//   P1 ── S1: worker W1 (wage 1500) assigned, entry E1 (rate 1500)
//   P2 ── S2: worker W2 (wage 2200) assigned, entry E2 (rate 2200)
//   pmFin   = project_manager, canViewFinance, member of P1 only
//   pmNoFin = project_manager, no flag, member of P1
//   sup     = site_supervisor assigned to P1/S1
//   supFlag = site_supervisor assigned to P1/S1 carrying canViewFinance (never grants)
// Company B
//   Q ── Y: worker WB, entry EB

interface World {
  admin: TestUser; finance: TestUser;
  pmFin: TestUser; pmNoFin: TestUser;
  sup: TestUser; supFlag: TestUser;
  adminB: TestUser;
  p1: string; s1: string; p2: string; s2: string;
  q: string; y: string;
  w1: string; w2: string; wb: string;
  e1: string; e2: string;
}

let w: World;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'wage-vis-a');
  const cid = a.company.id;
  const finance = await createTestUser(app, cid, 'finance_officer', 'wv-fo');
  const pmFin   = await createTestUser(app, cid, 'project_manager', 'wv-pmfin', { canViewFinance: true });
  const pmNoFin = await createTestUser(app, cid, 'project_manager', 'wv-pmnofin');
  const sup     = await createTestUser(app, cid, 'site_supervisor', 'wv-sup');
  const supFlag = await createTestUser(app, cid, 'site_supervisor', 'wv-supflag', { canViewFinance: true });

  const p1 = await createTestProject(cid, 'P1');
  const s1 = await createTestSite(cid, p1.id, 'S1');
  const p2 = await createTestProject(cid, 'P2');
  const s2 = await createTestSite(cid, p2.id, 'S2');

  await assignUserToProject(cid, p1.id, pmFin.id);
  await assignUserToProject(cid, p1.id, pmNoFin.id);
  await assignUserToProject(cid, p1.id, sup.id, s1.id);
  await assignUserToProject(cid, p1.id, supFlag.id, s1.id);

  const w1 = await createTestWorker(cid, { firstName: 'Wanjiru', trade: 'Mason', dailyWage: 1500 });
  const w2 = await createTestWorker(cid, { firstName: 'Otieno', trade: 'Carpenter', dailyWage: 2200 });
  await assignWorkerToSite(cid, p1.id, s1.id, w1.id, a.admin.id);
  await assignWorkerToSite(cid, p2.id, s2.id, w2.id, a.admin.id);

  const e1 = await createTestLabourEntry(cid, p1.id, s1.id, w1.id, a.admin.id, { dailyRate: 1500 });
  const e2 = await createTestLabourEntry(cid, p2.id, s2.id, w2.id, a.admin.id, { dailyRate: 2200 });

  const b = await createTestCompany(app, 'wage-vis-b');
  const q = await createTestProject(b.company.id, 'Q');
  const y = await createTestSite(b.company.id, q.id, 'Y');
  const wb = await createTestWorker(b.company.id, { dailyWage: 999 });
  await assignWorkerToSite(b.company.id, q.id, y.id, wb.id, b.admin.id);
  await createTestLabourEntry(b.company.id, q.id, y.id, wb.id, b.admin.id, { dailyRate: 999 });

  w = {
    admin: a.admin, finance, pmFin, pmNoFin, sup, supFlag, adminB: b.admin,
    p1: p1.id, s1: s1.id, p2: p2.id, s2: s2.id, q: q.id, y: y.id,
    w1: w1.id, w2: w2.id, wb: wb.id, e1: e1.id, e2: e2.id,
  };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

let dateSeq = 0;
function nextDate(): string {
  dateSeq += 1;
  return new Date(Date.UTC(2026, 5, 1 + dateSeq)).toISOString().slice(0, 10);
}

function req(
  user: TestUser,
  method: 'GET' | 'POST' | 'PATCH',
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

const labourUrl = (p: string, s: string, entryId?: string) =>
  `/projects/${p}/sites/${s}/labour${entryId ? `/${entryId}` : ''}`;

type Json = Record<string, unknown>;

function expectNoLabourFinance(entry: Json) {
  expect(entry).not.toHaveProperty('dailyRate');
  expect(entry).not.toHaveProperty('currency');
  // non-financial fields still present
  expect(entry).toHaveProperty('hoursWorked');
  expect(entry).toHaveProperty('date');
  expect(entry).toHaveProperty('workerId');
  expect(entry).toHaveProperty('worker');
}

function expectNoWorkerFinance(worker: Json) {
  expect(worker).not.toHaveProperty('dailyWage');
  expect(worker).not.toHaveProperty('currency');
  expect(worker).toHaveProperty('firstName');
  expect(worker).toHaveProperty('trade');
  expect(worker).toHaveProperty('employmentStatus');
}

const nonFinance  = () => [['site_supervisor', w.sup], ['site_supervisor+flag', w.supFlag], ['project_manager (no flag)', w.pmNoFin]] as const;
const financeP1   = () => [['company_admin', w.admin], ['finance_officer', w.finance], ['project_manager+flag', w.pmFin]] as const;

// ─── Labour reads ─────────────────────────────────────────────────────────────

describe('labour list / detail — wage fields', () => {
  it.each([0, 1, 2])('non-finance role #%s sees hours but no rate in the list', async (i) => {
    const [, user] = nonFinance()[i]!;
    const res = await req(user, 'GET', labourUrl(w.p1, w.s1));
    expect(res.statusCode).toBe(200);
    const { entries } = res.json() as { entries: Json[] };
    const e1 = entries.find((e) => e['id'] === w.e1)!;
    expect(e1).toBeDefined();
    expect(e1['hoursWorked']).toBe('8');
    for (const e of entries) expectNoLabourFinance(e);
  });

  it.each([0, 1, 2])('non-finance role #%s sees no rate on the single entry', async (i) => {
    const [, user] = nonFinance()[i]!;
    const res = await req(user, 'GET', labourUrl(w.p1, w.s1, w.e1));
    expect(res.statusCode).toBe(200);
    expectNoLabourFinance(res.json().entry);
  });

  it.each([0, 1, 2])('finance role #%s sees the rate in list and detail', async (i) => {
    const [, user] = financeP1()[i]!;
    const list = await req(user, 'GET', labourUrl(w.p1, w.s1));
    expect(list.statusCode).toBe(200);
    const e1 = (list.json().entries as Json[]).find((e) => e['id'] === w.e1)!;
    expect(e1['dailyRate']).toBe('1500');
    expect(e1['currency']).toBe('USD');

    const one = await req(user, 'GET', labourUrl(w.p1, w.s1, w.e1));
    expect(one.statusCode).toBe(200);
    expect(one.json().entry.dailyRate).toBe('1500');
    expect(one.json().entry.currency).toBe('USD');
  });

  it('PM with flag on a non-member project is still denied — 403', async () => {
    const res = await req(w.pmFin, 'GET', labourUrl(w.p2, w.s2));
    expect(res.statusCode).toBe(403);
    const one = await req(w.pmFin, 'GET', labourUrl(w.p2, w.s2, w.e2));
    expect(one.statusCode).toBe(403);
  });

  it('supervisor on a non-member project is still denied — 403', async () => {
    const res = await req(w.sup, 'GET', labourUrl(w.p2, w.s2));
    expect(res.statusCode).toBe(403);
  });

  it('cross-tenant admin is still denied — 404', async () => {
    const res = await req(w.adminB, 'GET', labourUrl(w.p1, w.s1));
    expect(res.statusCode).toBe(404);
    const one = await req(w.adminB, 'GET', labourUrl(w.p1, w.s1, w.e1));
    expect(one.statusCode).toBe(404);
  });
});

// ─── Labour writes ────────────────────────────────────────────────────────────

describe('labour writes — response not echoing rates', () => {
  // Owner decision A: a supervisor's submitted rate is ignored; derived from W1.
  it('supervisor creates; submitted dailyRate ignored, worker rate stored, not echoed', async () => {
    const res = await req(w.sup, 'POST', labourUrl(w.p1, w.s1), {
      workerId: w.w1, date: nextDate(), hoursWorked: 6, dailyRate: 1700, currency: 'USD',
    });
    expect(res.statusCode).toBe(201);
    const { entry } = res.json();
    expectNoLabourFinance(entry);
    expect(entry.hoursWorked).toBe('6');

    const row = await prisma.labourEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(row.dailyRate.toString()).toBe('1500');
    expect(row.currency).toBe('USD');
  });

  // Owner decision A: dailyRate is no longer required from a supervisor.
  it('supervisor create without dailyRate — 201, rate derived from the worker', async () => {
    const res = await req(w.sup, 'POST', labourUrl(w.p1, w.s1), {
      workerId: w.w1, date: nextDate(), hoursWorked: 6,
    });
    expect(res.statusCode).toBe(201);
    expectNoLabourFinance(res.json().entry);
    const row = await prisma.labourEntry.findUniqueOrThrow({ where: { id: res.json().entry.id } });
    expect(row.dailyRate.toString()).toBe('1500');
  });

  it('PM without flag: update response does not echo the rate; rate untouched', async () => {
    const res = await req(w.pmNoFin, 'PATCH', labourUrl(w.p1, w.s1, w.e1), { notes: 'checked' });
    expect(res.statusCode).toBe(200);
    expectNoLabourFinance(res.json().entry);
    const row = await prisma.labourEntry.findUniqueOrThrow({ where: { id: w.e1 } });
    expect(row.dailyRate.toString()).toBe('1500');
  });

  // Owner decision A: a supervisor's rate change is ignored.
  it('supervisor rate change is ignored; rate kept, not echoed', async () => {
    const created = await req(w.admin, 'POST', labourUrl(w.p1, w.s1), {
      workerId: w.w1, date: nextDate(), hoursWorked: 8, dailyRate: 1500,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().entry.id as string;

    const res = await req(w.sup, 'PATCH', labourUrl(w.p1, w.s1, id), { dailyRate: 1600 });
    expect(res.statusCode).toBe(200);
    expectNoLabourFinance(res.json().entry);
    const row = await prisma.labourEntry.findUniqueOrThrow({ where: { id } });
    expect(row.dailyRate.toString()).toBe('1500');
  });

  it('company_admin create and PM+flag update echo the rate', async () => {
    const created = await req(w.admin, 'POST', labourUrl(w.p1, w.s1), {
      workerId: w.w1, date: nextDate(), hoursWorked: 8, dailyRate: 1800, currency: 'KES',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().entry.dailyRate).toBe('1800');
    expect(created.json().entry.currency).toBe('KES');

    const upd = await req(w.pmFin, 'PATCH', labourUrl(w.p1, w.s1, created.json().entry.id), { hoursWorked: 7 });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().entry.dailyRate).toBe('1800');
  });
});

// ─── Worker reads ─────────────────────────────────────────────────────────────

describe('worker list / detail / site workers — wage fields', () => {
  it.each([0, 1, 2])('non-finance role #%s: /workers list has no wage', async (i) => {
    const [, user] = nonFinance()[i]!;
    const res = await req(user, 'GET', '/workers');
    expect(res.statusCode).toBe(200);
    const workers = res.json().workers as Json[];
    expect(workers.map((x) => x['id'])).toContain(w.w1);
    for (const x of workers) expectNoWorkerFinance(x);
  });

  it.each([0, 1, 2])('non-finance role #%s: /workers/:id has no wage', async (i) => {
    const [, user] = nonFinance()[i]!;
    const res = await req(user, 'GET', `/workers/${w.w1}`);
    expect(res.statusCode).toBe(200);
    expectNoWorkerFinance(res.json().worker);
  });

  it.each([0, 1, 2])('non-finance role #%s: site workers have no wage', async (i) => {
    const [, user] = nonFinance()[i]!;
    const res = await req(user, 'GET', `/projects/${w.p1}/sites/${w.s1}/workers`);
    expect(res.statusCode).toBe(200);
    const workers = res.json().workers as Json[];
    expect(workers.map((x) => x['id'])).toEqual([w.w1]);
    for (const x of workers) expectNoWorkerFinance(x);
  });

  it.each([0, 1, 2])('finance role #%s sees W1 wage in list, detail and site list', async (i) => {
    const [, user] = financeP1()[i]!;
    const list = await req(user, 'GET', '/workers');
    expect(list.statusCode).toBe(200);
    const w1 = (list.json().workers as Json[]).find((x) => x['id'] === w.w1)!;
    expect(w1['dailyWage']).toBe('1500');
    expect(w1['currency']).toBe('USD');

    const one = await req(user, 'GET', `/workers/${w.w1}`);
    expect(one.statusCode).toBe(200);
    expect(one.json().worker.dailyWage).toBe('1500');

    const site = await req(user, 'GET', `/projects/${w.p1}/sites/${w.s1}/workers`);
    expect(site.statusCode).toBe(200);
    expect((site.json().workers as Json[])[0]!['dailyWage']).toBe('1500');
  });

  it('PM+flag list scope unchanged: W2 (non-member project only) not listed', async () => {
    const res = await req(w.pmFin, 'GET', '/workers');
    expect((res.json().workers as Json[]).map((x) => x['id'])).not.toContain(w.w2);
  });

  // Worker detail now has the same scope as the list (see worker-scope.test.ts).
  it('PM+flag: worker only on a non-member project — 404 (outside scope)', async () => {
    const res = await req(w.pmFin, 'GET', `/workers/${w.w2}`);
    expect(res.statusCode).toBe(404);
  });

  it('company_admin/finance_officer see W2 wage company-wide', async () => {
    for (const user of [w.admin, w.finance]) {
      const res = await req(user, 'GET', `/workers/${w.w2}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().worker.dailyWage).toBe('2200');
    }
  });

  it('PM+flag on a non-member project site workers — 403 (unchanged)', async () => {
    const res = await req(w.pmFin, 'GET', `/projects/${w.p2}/sites/${w.s2}/workers`);
    expect(res.statusCode).toBe(403);
  });

  it('cross-tenant worker is still 404', async () => {
    const res = await req(w.pmFin, 'GET', `/workers/${w.wb}`);
    expect(res.statusCode).toBe(404);
    const res2 = await req(w.adminB, 'GET', `/workers/${w.w1}`);
    expect(res2.statusCode).toBe(404);
  });
});

// ─── Worker writes ────────────────────────────────────────────────────────────

describe('worker writes — response not echoing wage', () => {
  // Owner decision B: wage fields need financial authorisation.
  it('PM without flag creating with dailyWage — 403 FINANCE_ACCESS_DENIED', async () => {
    const res = await req(w.pmNoFin, 'POST', '/workers', {
      firstName: 'Kamau', lastName: 'Njoroge', trade: 'Welder', dailyWage: 2100, currency: 'KES',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FINANCE_ACCESS_DENIED');
  });

  it('PM without flag creating without wage fields — 201, no wage echoed', async () => {
    const res = await req(w.pmNoFin, 'POST', '/workers', {
      firstName: 'Kamau', lastName: 'Njoroge', trade: 'Welder',
    });
    expect(res.statusCode).toBe(201);
    expectNoWorkerFinance(res.json().worker);
  });

  it('PM without flag: update response has no wage; wage untouched', async () => {
    const res = await req(w.pmNoFin, 'PATCH', `/workers/${w.w1}`, { trade: 'Stone Mason' });
    expect(res.statusCode).toBe(200);
    expectNoWorkerFinance(res.json().worker);
    expect(res.json().worker.trade).toBe('Stone Mason');
    const row = await prisma.worker.findUniqueOrThrow({ where: { id: w.w1 } });
    expect(row.dailyWage?.toString()).toBe('1500');
  });

  it('company_admin create/update echo the wage', async () => {
    const res = await req(w.admin, 'POST', '/workers', {
      firstName: 'Achieng', lastName: 'Odhiambo', dailyWage: 1900, currency: 'USD',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().worker.dailyWage).toBe('1900');
    expect(res.json().worker.currency).toBe('USD');

    const upd = await req(w.admin, 'PATCH', `/workers/${res.json().worker.id}`, { dailyWage: 1950 });
    expect(upd.statusCode).toBe(200);
    expect(upd.json().worker.dailyWage).toBe('1950');
  });

  it('PM+flag update of a member-project worker echoes the wage', async () => {
    const res = await req(w.pmFin, 'PATCH', `/workers/${w.w1}`, { notes: 'reviewed' });
    expect(res.statusCode).toBe(200);
    expect(res.json().worker.dailyWage).toBe('1500');
  });
});
