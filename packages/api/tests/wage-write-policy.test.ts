/**
 * Wage WRITE policy — who may choose or change an individual pay rate.
 *
 * A. Labour entries (LabourEntry.dailyRate / currency)
 *    - Callers without financial permission (site_supervisor, project_manager
 *      without canViewFinance) may create/edit authorised labour entries but
 *      never choose the rate: the server derives dailyRate and currency from
 *      the trusted Worker.dailyWage / currency, ignoring anything submitted.
 *    - A worker with no daily wage on record → 422 WORKER_WAGE_MISSING (never 0).
 *    - Updates by non-finance callers never change dailyRate / currency.
 *    - Finance-authorised callers may supply dailyRate explicitly; when they
 *      omit it the rate is derived from the worker the same way.
 *
 * B. Worker wage fields (Worker.dailyWage / currency)
 *    - Writing them needs financial authorisation: company_admin company-wide;
 *      project_manager only with canViewFinance AND an active membership in a
 *      project where the worker is actively assigned. A new worker has no
 *      project yet, so a project_manager can never set wage fields on create.
 *    - Unauthorised writes that include wage fields → 403 FINANCE_ACCESS_DENIED;
 *      edits that omit wage fields keep working.
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
//   P1 ── S1: worker W1 (wage 1500 KES), worker WN (no wage), entry E1 (1500 KES)
//   P2 ── S2: worker W2 (wage 2200 USD)
//   pmFin   = project_manager + canViewFinance, member of P1
//   pmNoFin = project_manager, no flag, member of P1
//   sup     = site_supervisor assigned to P1/S1
//   supFlag = site_supervisor assigned to P1/S1 carrying canViewFinance (never grants)

interface World {
  admin: TestUser; pmFin: TestUser; pmNoFin: TestUser; sup: TestUser; supFlag: TestUser;
  p1: string; s1: string; p2: string; s2: string;
  w1: string; wn: string; w2: string; e1: string;
}

let w: World;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'wage-write-a');
  const cid = a.company.id;
  const pmFin   = await createTestUser(app, cid, 'project_manager', 'ww-pmfin', { canViewFinance: true });
  const pmNoFin = await createTestUser(app, cid, 'project_manager', 'ww-pmnofin');
  const sup     = await createTestUser(app, cid, 'site_supervisor', 'ww-sup');
  const supFlag = await createTestUser(app, cid, 'site_supervisor', 'ww-supflag', { canViewFinance: true });

  const p1 = await createTestProject(cid, 'P1');
  const s1 = await createTestSite(cid, p1.id, 'S1');
  const p2 = await createTestProject(cid, 'P2');
  const s2 = await createTestSite(cid, p2.id, 'S2');

  await assignUserToProject(cid, p1.id, pmFin.id);
  await assignUserToProject(cid, p1.id, pmNoFin.id);
  await assignUserToProject(cid, p1.id, sup.id, s1.id);
  await assignUserToProject(cid, p1.id, supFlag.id, s1.id);

  const w1 = await createTestWorker(cid, { firstName: 'Wanjiru', dailyWage: 1500 });
  await prisma.worker.update({ where: { id: w1.id }, data: { currency: 'KES' } });
  const wn = await createTestWorker(cid, { firstName: 'Nowage' });
  await prisma.worker.update({ where: { id: wn.id }, data: { dailyWage: null } });
  const w2 = await createTestWorker(cid, { firstName: 'Otieno', dailyWage: 2200 });

  await assignWorkerToSite(cid, p1.id, s1.id, w1.id, a.admin.id);
  await assignWorkerToSite(cid, p1.id, s1.id, wn.id, a.admin.id);
  await assignWorkerToSite(cid, p2.id, s2.id, w2.id, a.admin.id);

  const e1 = await createTestLabourEntry(cid, p1.id, s1.id, w1.id, a.admin.id, { dailyRate: 1500 });
  await prisma.labourEntry.update({ where: { id: e1.id }, data: { currency: 'KES' } });

  w = {
    admin: a.admin, pmFin, pmNoFin, sup, supFlag,
    p1: p1.id, s1: s1.id, p2: p2.id, s2: s2.id,
    w1: w1.id, wn: wn.id, w2: w2.id, e1: e1.id,
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
  return new Date(Date.UTC(2026, 6, 1 + dateSeq)).toISOString().slice(0, 10);
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

const labourUrl = (entryId?: string) =>
  `/projects/${w.p1}/sites/${w.s1}/labour${entryId ? `/${entryId}` : ''}`;

async function labourRow(id: string) {
  const row = await prisma.labourEntry.findUniqueOrThrow({ where: { id } });
  return { rate: row.dailyRate.toString(), currency: row.currency, hours: row.hoursWorked.toString() };
}

async function workerRow(id: string) {
  const row = await prisma.worker.findUniqueOrThrow({ where: { id } });
  return { wage: row.dailyWage?.toString() ?? null, currency: row.currency, trade: row.trade };
}

const nonFinance = () => [['site_supervisor', w.sup], ['site_supervisor+flag', w.supFlag], ['project_manager (no flag)', w.pmNoFin]] as const;

// ─── A. Labour create ─────────────────────────────────────────────────────────

describe('labour create — non-finance callers never choose the rate', () => {
  it.each([0, 1, 2])('non-finance #%s: submitted dailyRate/currency ignored; derived from worker', async (i) => {
    const [, user] = nonFinance()[i]!;
    const res = await req(user, 'POST', labourUrl(), {
      workerId: w.w1, date: nextDate(), hoursWorked: 6, dailyRate: 9999, currency: 'EUR',
    });
    expect(res.statusCode).toBe(201);
    const { entry } = res.json();
    expect(entry).not.toHaveProperty('dailyRate');
    expect(entry).not.toHaveProperty('currency');
    expect(entry.hoursWorked).toBe('6');
    expect(await labourRow(entry.id)).toEqual({ rate: '1500', currency: 'KES', hours: '6' });
  });

  it('non-finance caller may omit dailyRate entirely — rate derived from worker', async () => {
    const res = await req(w.sup, 'POST', labourUrl(), {
      workerId: w.w1, date: nextDate(), hoursWorked: 8,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().entry).not.toHaveProperty('dailyRate');
    expect(await labourRow(res.json().entry.id)).toEqual({ rate: '1500', currency: 'KES', hours: '8' });
  });

  it('worker without a daily wage → 422 WORKER_WAGE_MISSING, nothing stored (even with a submitted rate)', async () => {
    const before = await prisma.labourEntry.count({ where: { workerId: w.wn } });
    for (const payload of [
      { workerId: w.wn, date: nextDate(), hoursWorked: 8 },
      { workerId: w.wn, date: nextDate(), hoursWorked: 8, dailyRate: 100 },
    ]) {
      const res = await req(w.sup, 'POST', labourUrl(), payload);
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('WORKER_WAGE_MISSING');
      expect(res.json().error).toMatch(/no daily wage/i);
    }
    expect(await prisma.labourEntry.count({ where: { workerId: w.wn } })).toBe(before);
  });

  it('dailyRate still validated when present (negative → 422 VALIDATION_ERROR)', async () => {
    const res = await req(w.admin, 'POST', labourUrl(), {
      workerId: w.w1, date: nextDate(), hoursWorked: 8, dailyRate: -5,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });
});

describe('labour create — finance-authorised callers', () => {
  it('company_admin may supply an explicit rate and currency', async () => {
    const res = await req(w.admin, 'POST', labourUrl(), {
      workerId: w.w1, date: nextDate(), hoursWorked: 8, dailyRate: 1800, currency: 'GBP',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().entry.dailyRate).toBe('1800');
    expect(res.json().entry.currency).toBe('GBP');
    expect(await labourRow(res.json().entry.id)).toMatchObject({ rate: '1800', currency: 'GBP' });
  });

  it('company_admin omitting the rate gets it derived from the worker', async () => {
    const res = await req(w.admin, 'POST', labourUrl(), {
      workerId: w.w1, date: nextDate(), hoursWorked: 8,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().entry.dailyRate).toBe('1500');
    expect(res.json().entry.currency).toBe('KES');
  });

  it('company_admin omitting the rate for a worker without wage → 422 WORKER_WAGE_MISSING', async () => {
    const res = await req(w.admin, 'POST', labourUrl(), {
      workerId: w.wn, date: nextDate(), hoursWorked: 8,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('WORKER_WAGE_MISSING');
  });

  it('PM+flag on a member project may supply an explicit rate', async () => {
    const res = await req(w.pmFin, 'POST', labourUrl(), {
      workerId: w.w1, date: nextDate(), hoursWorked: 8, dailyRate: 2000, currency: 'KES',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().entry.dailyRate).toBe('2000');
    expect(await labourRow(res.json().entry.id)).toMatchObject({ rate: '2000', currency: 'KES' });
  });
});

// ─── A. Labour update ─────────────────────────────────────────────────────────

describe('labour update — non-finance callers cannot change rate/currency', () => {
  it.each([0, 1, 2])('non-finance #%s: dailyRate/currency ignored, hours/notes still updated', async (i) => {
    const [, user] = nonFinance()[i]!;
    const res = await req(user, 'PATCH', labourUrl(w.e1), {
      dailyRate: 1, currency: 'EUR', hoursWorked: 5 + i, notes: `checked ${i}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().entry).not.toHaveProperty('dailyRate');
    expect(res.json().entry.notes).toBe(`checked ${i}`);
    expect(await labourRow(w.e1)).toEqual({ rate: '1500', currency: 'KES', hours: String(5 + i) });
  });

  it('PM+flag on a member project may change the rate', async () => {
    const created = await req(w.admin, 'POST', labourUrl(), {
      workerId: w.w1, date: nextDate(), hoursWorked: 8,
    });
    const id = created.json().entry.id as string;
    const res = await req(w.pmFin, 'PATCH', labourUrl(id), { dailyRate: 2100 });
    expect(res.statusCode).toBe(200);
    expect(res.json().entry.dailyRate).toBe('2100');
    expect(await labourRow(id)).toMatchObject({ rate: '2100' });
  });

  it('company_admin may change the rate; the entry keeps its original currency', async () => {
    const created = await req(w.admin, 'POST', labourUrl(), {
      workerId: w.w1, date: nextDate(), hoursWorked: 8,
    });
    const id = created.json().entry.id as string;
    const original = (await labourRow(id)).currency;
    const other = original === 'USD' ? 'KES' : 'USD';

    const changed = await req(w.admin, 'PATCH', labourUrl(id), { dailyRate: 1700, currency: other });
    expect(changed.statusCode).toBe(422);
    expect(await labourRow(id)).toMatchObject({ currency: original });

    const res = await req(w.admin, 'PATCH', labourUrl(id), { dailyRate: 1700, currency: original });
    expect(res.statusCode).toBe(200);
    expect(await labourRow(id)).toMatchObject({ rate: '1700', currency: original });
  });
});

// ─── B. Worker wage writes ────────────────────────────────────────────────────

describe('worker create — wage fields need financial authorisation', () => {
  it.each([
    ['dailyWage', { dailyWage: 2100 }],
    ['currency', { currency: 'KES' }],
    ['both', { dailyWage: 2100, currency: 'KES' }],
  ])('PM without flag including %s → 403 FINANCE_ACCESS_DENIED, nothing created', async (_l, wage) => {
    const before = await prisma.worker.count({ where: { lastName: 'Denied-NoFin' } });
    const res = await req(w.pmNoFin, 'POST', '/workers', { firstName: 'Kamau', lastName: 'Denied-NoFin', ...wage });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FINANCE_ACCESS_DENIED');
    expect(await prisma.worker.count({ where: { lastName: 'Denied-NoFin' } })).toBe(before);
  });

  it('PM+flag cannot set wage on create either (no project yet) → 403', async () => {
    const res = await req(w.pmFin, 'POST', '/workers', {
      firstName: 'Kamau', lastName: 'Denied-Fin', dailyWage: 2100, currency: 'KES',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FINANCE_ACCESS_DENIED');
    expect(await prisma.worker.count({ where: { lastName: 'Denied-Fin' } })).toBe(0);
  });

  it('PM without wage fields still creates (currency defaults, no wage)', async () => {
    const res = await req(w.pmNoFin, 'POST', '/workers', { firstName: 'Ali', lastName: 'Hassan', trade: 'Welder' });
    expect(res.statusCode).toBe(201);
    expect(await workerRow(res.json().worker.id)).toEqual({ wage: null, currency: 'USD', trade: 'Welder' });
  });

  it('company_admin may set wage fields on create', async () => {
    const res = await req(w.admin, 'POST', '/workers', {
      firstName: 'Achieng', lastName: 'Odhiambo', dailyWage: 1900, currency: 'KES',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().worker.dailyWage).toBe('1900');
    expect(await workerRow(res.json().worker.id)).toMatchObject({ wage: '1900', currency: 'KES' });
  });
});

describe('worker update — wage fields need financial authorisation', () => {
  it.each([
    ['dailyWage', { dailyWage: 1 }],
    ['dailyWage=null', { dailyWage: null }],
    ['currency', { currency: 'EUR' }],
  ])('PM without flag changing %s → 403 FINANCE_ACCESS_DENIED, row unchanged', async (_l, wage) => {
    const res = await req(w.pmNoFin, 'PATCH', `/workers/${w.w1}`, { trade: 'Hacked', ...wage });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FINANCE_ACCESS_DENIED');
    expect(await workerRow(w.w1)).toMatchObject({ wage: '1500', currency: 'KES' });
    expect((await workerRow(w.w1)).trade).not.toBe('Hacked');
  });

  it('PM without flag: non-wage edit still works', async () => {
    const res = await req(w.pmNoFin, 'PATCH', `/workers/${w.w1}`, { trade: 'Stone Mason' });
    expect(res.statusCode).toBe(200);
    expect(res.json().worker.trade).toBe('Stone Mason');
    expect(await workerRow(w.w1)).toEqual({ wage: '1500', currency: 'KES', trade: 'Stone Mason' });
  });

  it('PM+flag may change the wage of a worker on a member project', async () => {
    const res = await req(w.pmFin, 'PATCH', `/workers/${w.w1}`, { dailyWage: 1600 });
    expect(res.statusCode).toBe(200);
    expect(res.json().worker.dailyWage).toBe('1600');
    expect(await workerRow(w.w1)).toMatchObject({ wage: '1600' });
    await prisma.worker.update({ where: { id: w.w1 }, data: { dailyWage: 1500 } });
  });

  it('PM+flag cannot change the wage of a worker only on a non-member project', async () => {
    const res = await req(w.pmFin, 'PATCH', `/workers/${w.w2}`, { dailyWage: 1 });
    expect([403, 404]).toContain(res.statusCode);
    expect(await workerRow(w.w2)).toMatchObject({ wage: '2200' });
  });

  it('PM+flag whose membership was removed loses wage write', async () => {
    await prisma.projectMember.updateMany({
      where: { userId: w.pmFin.id, projectId: w.p1 }, data: { removedAt: new Date() },
    });
    try {
      const res = await req(w.pmFin, 'PATCH', `/workers/${w.w1}`, { dailyWage: 1 });
      expect([403, 404]).toContain(res.statusCode);
      expect(await workerRow(w.w1)).toMatchObject({ wage: '1500' });
    } finally {
      await prisma.projectMember.updateMany({
        where: { userId: w.pmFin.id, projectId: w.p1 }, data: { removedAt: null },
      });
    }
  });

  it('company_admin may change wage and currency company-wide', async () => {
    const res = await req(w.admin, 'PATCH', `/workers/${w.w2}`, { dailyWage: 2300, currency: 'USD' });
    expect(res.statusCode).toBe(200);
    expect(await workerRow(w.w2)).toMatchObject({ wage: '2300', currency: 'USD' });
  });
});
