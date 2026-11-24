/**
 * Dashboard and invoice money figures follow the invoice lifecycle and never
 * add up amounts in different currencies.
 *
 *  - "Outstanding" is the unpaid balance (total - paid) of invoices the
 *    company owes: submitted, approved, partially paid, overdue and disputed.
 *    Draft and cancelled invoices are not owed; a paid invoice has no balance.
 *  - Every money figure is given per currency (`byCurrency`); the single
 *    number kept for older clients is the company currency's figure only.
 *  - The dashboard, GET /invoices/summary and the invoice report agree.
 *  - Inflows are not recorded anywhere in the product, so the dashboard no
 *    longer reports inflow totals or a net position computed from them.
 *  - Who receives money figures is unchanged (finance-authorization.test.ts
 *    holds the full matrix; the cases here pin the new fields to it).
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestInvoice,
  assignUserToProject,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

interface World {
  admin:        TestUser; // company_admin, canViewFinance
  adminNoFlag:  TestUser; // company_admin, canViewFinance=false
  fo:           TestUser; // finance_officer, canViewFinance
  foNoFlag:     TestUser; // finance_officer, canViewFinance=false
  pmFin:        TestUser; // project_manager, canViewFinance, member of P1 only
  pmNoFin:      TestUser; // project_manager without canViewFinance, member of P1
  supervisor:   TestUser;
  viewerFlag:   TestUser; // viewer with canViewFinance (flag grants nothing)
  worker:       TestUser;
  otherAdmin:   TestUser; // second company
}

let w: World;

// Company A works in KES. P1 holds one invoice in every status (KES); P2 holds
// two USD invoices. Figures below are the expected results.
//
//   status          total    paid     owed balance
//   draft            1000       0     - (not owed)
//   cancelled        2000     500     - (not owed)
//   submitted        4000       0     4000
//   approved         8000       0     8000
//   partially_paid  16000    6000    10000
//   overdue         32000    2000    30000
//   disputed        64000       0    64000
//   paid           128000  128000        0
//   KES           255000  136500   116000
//
//   USD (P2): approved 300 (owed 300), draft 50 (not owed)
const KES = { currency: 'KES', totalValue: 255000, totalPaid: 136500, outstanding: 116000 };
const USD = { currency: 'USD', totalValue: 350,    totalPaid: 0,      outstanding: 300 };

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const { company, admin } = await createTestCompany(app, 'dff-a');
  await prisma.company.update({ where: { id: company.id }, data: { currency: 'KES' } });
  const { company: companyB, admin: otherAdmin } = await createTestCompany(app, 'dff-b');

  const p1 = await createTestProject(company.id, 'DFF P1');
  const p2 = await createTestProject(company.id, 'DFF P2');
  const pB = await createTestProject(companyB.id, 'DFF other tenant');

  const adminNoFlag = await createTestUser(app, company.id, 'company_admin',   'dff-admin-noflag');
  const fo          = await createTestUser(app, company.id, 'finance_officer', 'dff-fo', { canViewFinance: true });
  const foNoFlag    = await createTestUser(app, company.id, 'finance_officer', 'dff-fo-noflag');
  const pmFin       = await createTestUser(app, company.id, 'project_manager', 'dff-pm-fin', { canViewFinance: true });
  const pmNoFin     = await createTestUser(app, company.id, 'project_manager', 'dff-pm-nofin');
  const supervisor  = await createTestUser(app, company.id, 'site_supervisor', 'dff-sup');
  const viewerFlag  = await createTestUser(app, company.id, 'viewer',          'dff-viewer', { canViewFinance: true });
  const worker      = await createTestUser(app, company.id, 'worker',          'dff-worker');
  for (const u of [pmFin, pmNoFin, supervisor]) await assignUserToProject(company.id, p1.id, u.id);

  const kes: Array<[import('@prisma/client').InvoiceStatus, number, number]> = [
    ['draft',            1000,      0],
    ['cancelled',        2000,    500],
    ['submitted',        4000,      0],
    ['approved',         8000,      0],
    ['partially_paid',  16000,   6000],
    ['overdue',         32000,   2000],
    ['disputed',        64000,      0],
    ['paid',           128000, 128000],
  ];
  for (const [status, totalAmount, paidAmount] of kes) {
    const inv = await createTestInvoice(company.id, p1.id, { status, totalAmount, currency: 'KES' });
    if (paidAmount > 0) await prisma.invoice.update({ where: { id: inv.id }, data: { paidAmount } });
  }
  await createTestInvoice(company.id, p2.id, { status: 'approved', totalAmount: 300, currency: 'USD' });
  await createTestInvoice(company.id, p2.id, { status: 'draft',    totalAmount: 50,  currency: 'USD' });

  // Other tenant: never visible to company A.
  await createTestInvoice(companyB.id, pB.id, { status: 'approved', totalAmount: 777, currency: 'USD' });

  // An inflow row (only the seed and tests create these): the dashboard must
  // not turn it into a cash or net-position figure.
  await prisma.financeInflow.create({
    data: {
      companyId: company.id, projectId: p1.id, sourceType: 'sales_revenue', sourceName: 'Unit sales',
      amount: 500000, currency: 'KES', transactionDate: new Date(), recordedById: admin.id,
    },
  });

  w = { admin, adminNoFlag, fo, foNoFlag, pmFin, pmNoFin, supervisor, viewerFlag, worker, otherAdmin };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

function get(url: string, user: TestUser) {
  return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${user.accessToken}` } });
}

const summaryValue = (summary: Array<{ label: string; value: string }>, label: string) =>
  summary.find((s) => s.label === label)?.value;

// ─── Outstanding follows the lifecycle, per currency ──────────────────────────

describe('dashboard invoice figures', () => {
  it('outstanding counts only owed statuses, in the company currency', async () => {
    const res = await get('/api/v1/dashboard', w.admin);
    expect(res.statusCode).toBe(200);
    const { invoices } = res.json().stats;
    expect(invoices.outstanding).toBe(KES.outstanding);
    expect(invoices.totalValue).toBe(KES.totalValue);
    expect(invoices.totalPaid).toBe(KES.totalPaid);
    // Counts are not money and still cover every invoice in scope.
    expect(invoices.total).toBe(10);
    expect(invoices.overdueCount).toBe(1);
    expect(invoices.pendingApproval).toBe(1);
  });

  it('gives one figure per currency and never a mixed sum', async () => {
    const { invoices } = (await get('/api/v1/dashboard', w.admin)).json().stats;
    expect(invoices.byCurrency).toEqual([KES, USD]);
    // 116000 KES + 300 USD must never appear as 116300 (or 118850, the old
    // all-status, all-currency balance).
    expect(JSON.stringify(invoices)).not.toMatch(/116300|118850/);
  });

  it('finance_officer gets the same figures as company_admin', async () => {
    for (const u of [w.fo, w.foNoFlag, w.adminNoFlag]) {
      const { invoices } = (await get('/api/v1/dashboard', u)).json().stats;
      expect(invoices.outstanding).toBe(KES.outstanding);
      expect(invoices.byCurrency).toEqual([KES, USD]);
    }
  });

  it('a project manager with finance access gets member-project figures only', async () => {
    const { invoices } = (await get('/api/v1/dashboard', w.pmFin)).json().stats;
    expect(invoices.outstanding).toBe(KES.outstanding);
    expect(invoices.byCurrency).toEqual([KES]); // P2's USD invoices are outside scope
    expect(invoices.total).toBe(8);
  });

  it('another company sees only its own invoices', async () => {
    const { invoices } = (await get('/api/v1/dashboard', w.otherAdmin)).json().stats;
    // Company B works in USD (fixture default).
    expect(invoices.outstanding).toBe(777);
    expect(invoices.byCurrency).toEqual([{ currency: 'USD', totalValue: 777, totalPaid: 0, outstanding: 777 }]);
  });
});

// ─── Who receives money figures is unchanged ──────────────────────────────────

describe('financial gating is unchanged', () => {
  it.each([
    ['PM without canViewFinance', 'pmNoFin'],
    ['site_supervisor',           'supervisor'],
    ['viewer with the flag set',  'viewerFlag'],
    ['worker',                    'worker'],
  ] as const)('%s gets every invoice money field as null', async (_label, key) => {
    const res = await get('/api/v1/dashboard', w[key]);
    expect(res.statusCode).toBe(200);
    const { stats } = res.json();
    expect(stats.invoices).toEqual({
      total: null, totalValue: null, totalPaid: null, outstanding: null,
      overdueCount: null, pendingApproval: null, byCurrency: null,
    });
    expect(stats.finance).toBeUndefined();
    expect(res.payload).not.toContain('116000');
  });

  it.each([
    ['PM without canViewFinance', 'pmNoFin'],
    ['site_supervisor',           'supervisor'],
    ['viewer with the flag set',  'viewerFlag'],
    ['worker',                    'worker'],
  ] as const)('%s is refused the invoice summary', async (_label, key) => {
    const res = await get('/api/v1/invoices/summary', w[key]);
    expect(res.statusCode).toBe(403);
    expect(res.json().summary).toBeUndefined();
  });
});

// ─── No inflow / net position figure ──────────────────────────────────────────

describe('inflow and net position are not reported', () => {
  it.each(['admin', 'fo', 'adminNoFlag', 'foNoFlag', 'pmFin'] as const)(
    '%s gets no finance (inflow / net position) block',
    async (key) => {
      const res = await get('/api/v1/dashboard', w[key]);
      expect(res.statusCode).toBe(200);
      expect(res.json().stats.finance).toBeUndefined();
      expect(res.payload).not.toMatch(/netPosition|totalInflows|inflowsThisMonth/);
      expect(res.payload).not.toContain('500000');
    },
  );
});

// ─── The invoice summary and report agree with the dashboard ─────────────────

describe('GET /invoices/summary', () => {
  it('uses the same owed statuses and currency split as the dashboard', async () => {
    const res = await get('/api/v1/invoices/summary', w.admin);
    expect(res.statusCode).toBe(200);
    const { summary } = res.json();
    expect(summary.currency).toBe('KES');
    expect(summary.totalOutstanding).toBe(KES.outstanding);
    expect(summary.totalValue).toBe(KES.totalValue);
    expect(summary.totalPaid).toBe(KES.totalPaid);
    expect(summary.overdueValue).toBe(30000);
    expect(summary.totalCount).toBe(10);
    expect(summary.overdueCount).toBe(1);
    expect(summary.byCurrency).toEqual([
      { ...KES, overdueValue: 30000 },
      { ...USD, overdueValue: 0 },
    ]);
  });

  it('matches the dashboard figure for a scoped project manager', async () => {
    const dash = (await get('/api/v1/dashboard', w.pmFin)).json().stats.invoices;
    const { summary } = (await get('/api/v1/invoices/summary', w.pmFin)).json();
    expect(summary.totalOutstanding).toBe(dash.outstanding);
    expect(summary.byCurrency.map(({ overdueValue: _o, ...rest }: { overdueValue: number }) => rest))
      .toEqual(dash.byCurrency);
  });
});

describe('GET /reports/invoices summary', () => {
  it('states value, paid and outstanding per currency with the owed statuses', async () => {
    const res = await get('/api/v1/reports/invoices', w.admin);
    expect(res.statusCode).toBe(200);
    const { summary, rows } = res.json().report;
    expect(rows).toHaveLength(10);
    expect(summaryValue(summary, 'Total Invoices')).toBe('10');
    expect(summaryValue(summary, 'Total Value')).toBe('255000.00 KES + 350.00 USD');
    expect(summaryValue(summary, 'Total Paid')).toBe('136500.00 KES + 0.00 USD');
    expect(summaryValue(summary, 'Outstanding')).toBe('116000.00 KES + 300.00 USD');
    expect(summaryValue(summary, 'Overdue')).toBe('1');
  });
});
