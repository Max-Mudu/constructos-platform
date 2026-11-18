/**
 * Labour cost consistency: one rule everywhere.
 *
 * Every labour rate in the model is a DAILY rate (LabourEntry.dailyRate,
 * Worker.dailyWage; there is no hourly rate or rate-type column), and the
 * approved cost of an entry is hoursWorked / 8 x dailyRate (pro rata, no cap
 * above 8 h). Amounts in different currencies are never added together.
 *
 * The web Labour Register already used that rule; the dashboard month cost and
 * the labour report "Total Cost" used to add the full daily rate per entry
 * whatever the hours, and summed currencies together. These tests pin the
 * three figures to the same numbers for the same data, and check that callers
 * without finance visibility still get no amounts from any of them.
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
  createTestLabourEntry,
  assignUserToProject,
  clearDatabase,
  TestUser,
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

function get(user: TestUser, url: string) {
  return app.inject({
    method:  'GET',
    url:     `/api/v1${url}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
}

// Today's calendar date, so the entries fall inside the dashboard's month.
function today(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
}

// The data: company currency USD; three USD workers and one KES worker.
//   6.5 h  x 1800 USD/day -> 1462.50 USD   (fractional hours, partial day)
//   4 h    x 1200 USD/day ->  600.00 USD   (half day)
//   10 h   x 2000 USD/day -> 2500.00 USD   (above a day: pro rata, not capped)
//   7.25 h x 3000 KES/day -> 2718.75 KES   (another currency)
// The old rule (one full day rate per entry, currencies summed) gave 8000.
const ENTRIES = [
  { last: 'Fraction', hours: 6.5,  rate: 1800, currency: 'USD' },
  { last: 'Half',     hours: 4,    rate: 1200, currency: 'USD' },
  { last: 'Long',     hours: 10,   rate: 2000, currency: 'USD' },
  { last: 'Shilling', hours: 7.25, rate: 3000, currency: 'KES' },
];
const USD_TOTAL = 4562.5;
const KES_TOTAL = 2718.75;

async function buildWorld() {
  const { company, admin } = await createTestCompany(app, 'lcost');
  const project = await createTestProject(company.id, 'Cost Project');
  const site    = await createTestSite(company.id, project.id, 'Cost Site');
  const finance = await createTestUser(app, company.id, 'finance_officer', 'lcost-fo', { canViewFinance: true });
  const pm      = await createTestUser(app, company.id, 'project_manager', 'lcost-pm');
  const pmFin   = await createTestUser(app, company.id, 'project_manager', 'lcost-pmfin', { canViewFinance: true });
  const sup     = await createTestUser(app, company.id, 'site_supervisor', 'lcost-ss');
  await assignUserToProject(company.id, project.id, pm.id);
  await assignUserToProject(company.id, project.id, pmFin.id);
  await assignUserToProject(company.id, project.id, sup.id, site.id);

  const date = today();
  for (const e of ENTRIES) {
    const w = await createTestWorker(company.id, { firstName: 'Cost', lastName: e.last, dailyWage: e.rate });
    await createTestLabourEntry(company.id, project.id, site.id, w.id, admin.id, {
      date, hoursWorked: e.hours, dailyRate: e.rate, currency: e.currency,
    });
  }
  return { admin, finance, pm, pmFin, sup, project, site };
}

type Summary = Array<{ label: string; value: string }>;
const totalCost = (summary: Summary) => summary.find((s) => s.label === 'Total Cost')?.value;

/** The Labour Register's figure: the web sums hours / 8 x dailyRate per currency. */
function registerTotals(entries: Array<{ hoursWorked: string; dailyRate?: string; currency?: string }>) {
  const totals: Record<string, number> = {};
  for (const e of entries) {
    const cur = e.currency ?? '';
    totals[cur] = (totals[cur] ?? 0) + (Number(e.hoursWorked) / 8) * Number(e.dailyRate);
  }
  return totals;
}

describe('labour cost: register, dashboard and report agree', () => {
  it('register (list) figures: hours / 8 x daily rate, per currency', async () => {
    const w = await buildWorld();
    const res = await get(w.admin, `/projects/${w.project.id}/sites/${w.site.id}/labour`);
    expect(res.statusCode).toBe(200);
    expect(registerTotals(res.json().entries)).toEqual({ USD: USD_TOTAL, KES: KES_TOTAL });
  });

  it('dashboard month cost uses the same rule and never adds currencies', async () => {
    const w = await buildWorld();
    for (const u of [w.admin, w.finance, w.pmFin]) {
      const res = await get(u, '/dashboard');
      expect(res.statusCode).toBe(200);
      const { labour } = res.json().stats;
      // thisMonthCost: the company-currency (USD) figure only.
      expect(labour.thisMonthCost).toBe(USD_TOTAL);
      expect(labour.thisMonthCostByCurrency).toEqual([
        { currency: 'KES', total: KES_TOTAL },
        { currency: 'USD', total: USD_TOTAL },
      ]);
      expect(labour.thisWeekHours).toBeCloseTo(27.75, 5);
    }
  });

  it('labour report Total Cost uses the same rule, one figure per currency', async () => {
    const w = await buildWorld();
    for (const u of [w.admin, w.finance, w.pmFin]) {
      const res = await get(u, '/reports/labour');
      expect(res.statusCode).toBe(200);
      const { summary } = res.json().report;
      expect(totalCost(summary)).toBe('2718.75 KES + 4562.50 USD');
      expect(summary.find((s: { label: string }) => s.label === 'Total Hours')?.value).toBe('27.8');
    }
  });

  it('the report CSV carries the same Total Cost', async () => {
    const w = await buildWorld();
    const res = await get(w.finance, '/reports/labour?format=csv');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('2718.75 KES + 4562.50 USD');
    expect(res.body).not.toContain('8000');
  });

  it('a single-currency report keeps one figure, with its currency', async () => {
    const { company, admin } = await createTestCompany(app, 'lcost-one');
    const project = await createTestProject(company.id, 'One Currency');
    const site    = await createTestSite(company.id, project.id, 'Site');
    const a = await createTestWorker(company.id, { lastName: 'A' });
    const b = await createTestWorker(company.id, { lastName: 'B' });
    await createTestLabourEntry(company.id, project.id, site.id, a.id, admin.id, { date: today(), hoursWorked: 6, dailyRate: 1800 });
    await createTestLabourEntry(company.id, project.id, site.id, b.id, admin.id, { date: today(), hoursWorked: 8, dailyRate: 1500 });
    const rep = await get(admin, '/reports/labour');
    expect(totalCost(rep.json().report.summary)).toBe('2850.00 USD');
    const dash = await get(admin, '/dashboard');
    expect(dash.json().stats.labour.thisMonthCost).toBe(2850);
    expect(dash.json().stats.labour.thisMonthCostByCurrency).toEqual([{ currency: 'USD', total: 2850 }]);
  });

  it('an empty month gives zero cost and an empty per-currency list', async () => {
    const { admin } = await createTestCompany(app, 'lcost-empty');
    const dash = await get(admin, '/dashboard');
    expect(dash.json().stats.labour.thisMonthCost).toBe(0);
    expect(dash.json().stats.labour.thisMonthCostByCurrency).toEqual([]);
    const rep = await get(admin, '/reports/labour');
    expect(totalCost(rep.json().report.summary)).toBe('0.00');
  });
});

describe('labour cost: roles without finance visibility still get no amounts', () => {
  it.each(['pm', 'sup'] as const)('%s: no cost on the dashboard, report or register', async (key) => {
    const w = await buildWorld();
    const user = w[key];

    const dash = await get(user, '/dashboard');
    expect(dash.statusCode).toBe(200);
    expect(dash.json().stats.labour.thisMonthCost).toBeNull();
    expect(dash.json().stats.labour.thisMonthCostByCurrency).toBeNull();

    const rep = await get(user, '/reports/labour');
    expect(rep.statusCode).toBe(200);
    expect(totalCost(rep.json().report.summary)).toBeUndefined();
    const body = JSON.stringify(rep.json());
    for (const amount of ['1462', '4562', '2718', '1800.00', 'KES']) expect(body).not.toContain(amount);

    const list = await get(user, `/projects/${w.project.id}/sites/${w.site.id}/labour`);
    expect(list.statusCode).toBe(200);
    for (const e of list.json().entries) {
      expect(e.dailyRate).toBeUndefined();
      expect(e.currency).toBeUndefined();
    }
  });
});
