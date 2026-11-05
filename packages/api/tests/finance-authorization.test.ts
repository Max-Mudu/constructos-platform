/**
 * Financial read-authorisation matrix.
 *
 * Owner policy (financial reads = invoices list/detail/summary, budgets
 * list/detail, dashboard money fields):
 *   - company_admin, finance_officer: company-wide.
 *   - project_manager: only when canViewFinance === true, and then only for
 *     projects where they hold an ACTIVE membership (removedAt null).
 *     Membership alone never grants financial access.
 *   - contractor: no access to internal invoice records or summaries, even for
 *     invoices that reference their own contractor record.
 *   - site_supervisor, consultant, viewer, worker: no financial access, even if
 *     the canViewFinance flag is set on the account.
 *   - Cross-tenant data is never visible.
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
  createTestContractor,
  createTestInvoice,
  createTestBudget,
  createTestLineItem,
  assignUserToProject,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

interface World {
  admin:          TestUser;
  fo:             TestUser;
  pmFinMember:    TestUser; // PM, canViewFinance, active member of P1 only
  pmFinRemoved:   TestUser; // PM, canViewFinance, membership of P1 removed
  pmFinNone:      TestUser; // PM, canViewFinance, no memberships
  pmNoFinMember:  TestUser; // PM, canViewFinance=false, active member of P1
  supervisor:     TestUser; // member of P1
  contractor:     TestUser; // linked to contractor record C1 (invoice inv1)
  consultant:     TestUser; // referenced by inv2.consultantUserId, member of P2
  viewer:         TestUser;
  viewerFinFlag:  TestUser; // viewer with canViewFinance=true (flag must not grant access)
  worker:         TestUser;
  otherAdmin:     TestUser; // company B
  p1: string; p2: string; p3: string;
  inv1: string; inv2: string; inv3: string;
  b1: string; b2: string; b3: string;
}

let w: World;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const { company, admin } = await createTestCompany(app, 'finauth-a');
  const { company: companyB, admin: otherAdmin } = await createTestCompany(app, 'finauth-b');

  const p1 = await createTestProject(company.id, 'Finauth P1');
  const p2 = await createTestProject(company.id, 'Finauth P2');
  const p3 = await createTestProject(companyB.id, 'Finauth P3 (other tenant)');

  const fo            = await createTestUser(app, company.id, 'finance_officer', 'finauth-fo', { canViewFinance: true });
  const pmFinMember   = await createTestUser(app, company.id, 'project_manager', 'finauth-pm-fin-member', { canViewFinance: true });
  const pmFinRemoved  = await createTestUser(app, company.id, 'project_manager', 'finauth-pm-fin-removed', { canViewFinance: true });
  const pmFinNone     = await createTestUser(app, company.id, 'project_manager', 'finauth-pm-fin-none', { canViewFinance: true });
  const pmNoFinMember = await createTestUser(app, company.id, 'project_manager', 'finauth-pm-nofin-member');
  const supervisor    = await createTestUser(app, company.id, 'site_supervisor', 'finauth-sup');
  const contractor    = await createTestUser(app, company.id, 'contractor', 'finauth-con');
  const consultant    = await createTestUser(app, company.id, 'consultant', 'finauth-cons');
  const viewer        = await createTestUser(app, company.id, 'viewer', 'finauth-viewer');
  const viewerFinFlag = await createTestUser(app, company.id, 'viewer', 'finauth-viewer-flag', { canViewFinance: true });
  const worker        = await createTestUser(app, company.id, 'worker', 'finauth-worker');

  await assignUserToProject(company.id, p1.id, pmFinMember.id);
  await assignUserToProject(company.id, p1.id, pmFinRemoved.id);
  await prisma.projectMember.updateMany({
    where: { projectId: p1.id, userId: pmFinRemoved.id },
    data:  { removedAt: new Date() },
  });
  await assignUserToProject(company.id, p1.id, pmNoFinMember.id);
  await assignUserToProject(company.id, p1.id, supervisor.id);
  await assignUserToProject(company.id, p1.id, contractor.id);
  await assignUserToProject(company.id, p2.id, consultant.id);

  const c1 = await createTestContractor(company.id, 'Own Contractor', contractor.id);

  const inv1 = await createTestInvoice(company.id, p1.id, {
    invoiceNumber: 'FA-INV-1', totalAmount: 1000, status: 'draft', vendorType: 'contractor', contractorId: c1.id,
  });
  const inv2 = await createTestInvoice(company.id, p2.id, {
    invoiceNumber: 'FA-INV-2', totalAmount: 2000, status: 'draft', vendorType: 'consultant', consultantUserId: consultant.id,
  });
  const inv3 = await createTestInvoice(companyB.id, p3.id, {
    invoiceNumber: 'FA-INV-3', totalAmount: 99999, status: 'draft',
  });

  const b1 = await createTestBudget(company.id, p1.id, { name: 'Budget P1' });
  await createTestLineItem(b1.id, company.id, p1.id, { budgetedAmount: 5000, actualSpend: 1000 });
  const b2 = await createTestBudget(company.id, p2.id, { name: 'Budget P2' });
  await createTestLineItem(b2.id, company.id, p2.id, { budgetedAmount: 7000, actualSpend: 500 });
  const b3 = await createTestBudget(companyB.id, p3.id, { name: 'Budget P3' });
  await createTestLineItem(b3.id, companyB.id, p3.id, { budgetedAmount: 88888, actualSpend: 0 });

  // Labour this month: P1 = 100, P2 = 300
  const s1 = await createTestSite(company.id, p1.id, 'S1');
  const s2 = await createTestSite(company.id, p2.id, 'S2');
  const wk = await createTestWorker(company.id);
  const today = new Date();
  await createTestLabourEntry(company.id, p1.id, s1.id, wk.id, admin.id, { date: today, dailyRate: 100 });
  await createTestLabourEntry(company.id, p2.id, s2.id, wk.id, admin.id, { date: today, dailyRate: 300 });

  w = {
    admin, fo, pmFinMember, pmFinRemoved, pmFinNone, pmNoFinMember, supervisor, contractor, consultant,
    viewer, viewerFinFlag, worker, otherAdmin,
    p1: p1.id, p2: p2.id, p3: p3.id,
    inv1: inv1.id, inv2: inv2.id, inv3: inv3.id,
    b1: b1.id, b2: b2.id, b3: b3.id,
  };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

function get(url: string, user: TestUser) {
  return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${user.accessToken}` } });
}

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort();

// Users with NO financial read access at all.
type UserKey = { [K in keyof World]: World[K] extends TestUser ? K : never }[keyof World];
const DENIED: Array<[string, UserKey]> = [
  ['PM without canViewFinance (member)', 'pmNoFinMember'],
  ['site_supervisor',                    'supervisor'],
  ['contractor (own invoice exists)',    'contractor'],
  ['consultant (referenced on invoice)', 'consultant'],
  ['viewer',                             'viewer'],
  ['viewer with canViewFinance flag',    'viewerFinFlag'],
  ['worker',                             'worker'],
];

// ─── Invoices ──────────────────────────────────────────────────────────────────

describe('GET /invoices — list', () => {
  it('company_admin sees all company invoices, never other tenant', async () => {
    const res = await get('/api/v1/invoices', w.admin);
    expect(res.statusCode).toBe(200);
    expect(ids(res.json().invoices)).toEqual([w.inv1, w.inv2].sort());
  });

  it('finance_officer sees all company invoices', async () => {
    const res = await get('/api/v1/invoices', w.fo);
    expect(res.statusCode).toBe(200);
    expect(ids(res.json().invoices)).toEqual([w.inv1, w.inv2].sort());
  });

  it('PM with canViewFinance sees only active-member project invoices', async () => {
    const res = await get('/api/v1/invoices', w.pmFinMember);
    expect(res.statusCode).toBe(200);
    expect(ids(res.json().invoices)).toEqual([w.inv1]);
  });

  it('PM with canViewFinance cannot widen scope via ?projectId', async () => {
    const res = await get(`/api/v1/invoices?projectId=${w.p2}`, w.pmFinMember);
    expect(res.statusCode).toBe(200);
    expect(res.json().invoices).toEqual([]);
    const cross = await get(`/api/v1/invoices?projectId=${w.p3}`, w.pmFinMember);
    expect(cross.statusCode).toBe(200);
    expect(cross.json().invoices).toEqual([]);
  });

  it('PM with canViewFinance but removed membership sees nothing', async () => {
    const res = await get('/api/v1/invoices', w.pmFinRemoved);
    expect(res.statusCode).toBe(200);
    expect(res.json().invoices).toEqual([]);
  });

  it('PM with canViewFinance and no membership sees nothing', async () => {
    const res = await get('/api/v1/invoices', w.pmFinNone);
    expect(res.statusCode).toBe(200);
    expect(res.json().invoices).toEqual([]);
  });

  it.each(DENIED)('%s gets 403', async (_label, key) => {
    const user = w[key];
    const res = await get('/api/v1/invoices', user);
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.json())).not.toContain('FA-INV');
  });
});

describe('GET /invoices/:id — detail', () => {
  it('company_admin and finance_officer can read any company invoice', async () => {
    for (const u of [w.admin, w.fo]) {
      for (const id of [w.inv1, w.inv2]) {
        const res = await get(`/api/v1/invoices/${id}`, u);
        expect(res.statusCode).toBe(200);
        expect(res.json().invoice.id).toBe(id);
      }
    }
  });

  it('company_admin gets 404 for other tenant invoice', async () => {
    const res = await get(`/api/v1/invoices/${w.inv3}`, w.admin);
    expect(res.statusCode).toBe(404);
  });

  it('PM with canViewFinance reads member-project invoice, 404 outside scope', async () => {
    expect((await get(`/api/v1/invoices/${w.inv1}`, w.pmFinMember)).statusCode).toBe(200);
    expect((await get(`/api/v1/invoices/${w.inv2}`, w.pmFinMember)).statusCode).toBe(404);
    expect((await get(`/api/v1/invoices/${w.inv3}`, w.pmFinMember)).statusCode).toBe(404);
  });

  it('PM with canViewFinance but removed / no membership gets 404', async () => {
    expect((await get(`/api/v1/invoices/${w.inv1}`, w.pmFinRemoved)).statusCode).toBe(404);
    expect((await get(`/api/v1/invoices/${w.inv1}`, w.pmFinNone)).statusCode).toBe(404);
  });

  it.each(DENIED)('%s gets 403 on own-project / linked invoices', async (_label, key) => {
    const user = w[key];
    for (const id of [w.inv1, w.inv2]) {
      const res = await get(`/api/v1/invoices/${id}`, user);
      expect(res.statusCode).toBe(403);
      expect(JSON.stringify(res.json())).not.toContain('FA-INV');
    }
  });
});

describe('GET /invoices/summary', () => {
  it('company_admin and finance_officer get company-wide totals', async () => {
    for (const u of [w.admin, w.fo]) {
      const res = await get('/api/v1/invoices/summary', u);
      expect(res.statusCode).toBe(200);
      expect(res.json().summary.totalCount).toBe(2);
      expect(res.json().summary.totalValue).toBe(3000);
    }
  });

  it('PM with canViewFinance gets member-project totals only', async () => {
    const res = await get('/api/v1/invoices/summary', w.pmFinMember);
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.totalCount).toBe(1);
    expect(res.json().summary.totalValue).toBe(1000);
  });

  it('PM with canViewFinance cannot widen summary via ?projectId', async () => {
    const res = await get(`/api/v1/invoices/summary?projectId=${w.p2}`, w.pmFinMember);
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.totalCount).toBe(0);
    expect(res.json().summary.totalValue).toBe(0);
  });

  it('PM with canViewFinance but removed membership gets zero totals', async () => {
    const res = await get('/api/v1/invoices/summary', w.pmFinRemoved);
    expect(res.statusCode).toBe(200);
    expect(res.json().summary.totalValue).toBe(0);
  });

  it.each(DENIED)('%s gets 403', async (_label, key) => {
    const user = w[key];
    const res = await get('/api/v1/invoices/summary', user);
    expect(res.statusCode).toBe(403);
    expect(res.json().summary).toBeUndefined();
  });
});

// ─── Budgets ───────────────────────────────────────────────────────────────────

describe('GET /budgets — list', () => {
  it('company_admin and finance_officer see all company budgets', async () => {
    for (const u of [w.admin, w.fo]) {
      const res = await get('/api/v1/budgets', u);
      expect(res.statusCode).toBe(200);
      expect(ids(res.json().budgets)).toEqual([w.b1, w.b2].sort());
    }
  });

  it('PM with canViewFinance sees only active-member project budgets', async () => {
    const res = await get('/api/v1/budgets', w.pmFinMember);
    expect(res.statusCode).toBe(200);
    expect(ids(res.json().budgets)).toEqual([w.b1]);
    const widened = await get(`/api/v1/budgets?projectId=${w.p2}`, w.pmFinMember);
    expect(widened.statusCode).toBe(200);
    expect(widened.json().budgets).toEqual([]);
  });

  it('PM with canViewFinance but removed / no membership sees nothing', async () => {
    for (const u of [w.pmFinRemoved, w.pmFinNone]) {
      const res = await get('/api/v1/budgets', u);
      expect(res.statusCode).toBe(200);
      expect(res.json().budgets).toEqual([]);
    }
  });

  it.each(DENIED)('%s gets 403', async (_label, key) => {
    const user = w[key];
    const res = await get('/api/v1/budgets', user);
    expect(res.statusCode).toBe(403);
    expect(JSON.stringify(res.json())).not.toContain('Budget P');
  });
});

describe('GET /budgets/:id — detail', () => {
  it('company_admin and finance_officer can read any company budget', async () => {
    for (const u of [w.admin, w.fo]) {
      for (const id of [w.b1, w.b2]) {
        const res = await get(`/api/v1/budgets/${id}`, u);
        expect(res.statusCode).toBe(200);
        expect(res.json().budget.id).toBe(id);
      }
    }
    expect((await get(`/api/v1/budgets/${w.b3}`, w.admin)).statusCode).toBe(404);
  });

  it('PM with canViewFinance reads member-project budget, 404 outside scope', async () => {
    expect((await get(`/api/v1/budgets/${w.b1}`, w.pmFinMember)).statusCode).toBe(200);
    expect((await get(`/api/v1/budgets/${w.b2}`, w.pmFinMember)).statusCode).toBe(404);
    expect((await get(`/api/v1/budgets/${w.b3}`, w.pmFinMember)).statusCode).toBe(404);
    expect((await get(`/api/v1/budgets/${w.b1}`, w.pmFinRemoved)).statusCode).toBe(404);
    expect((await get(`/api/v1/budgets/${w.b1}`, w.pmFinNone)).statusCode).toBe(404);
  });

  it.each(DENIED)('%s gets 403', async (_label, key) => {
    const user = w[key];
    for (const id of [w.b1, w.b2]) {
      const res = await get(`/api/v1/budgets/${id}`, user);
      expect(res.statusCode).toBe(403);
      expect(res.json().summary).toBeUndefined();
    }
  });
});

// ─── Dashboard ─────────────────────────────────────────────────────────────────

describe('GET /dashboard — money fields', () => {
  it('company_admin and finance_officer get company-wide money totals', async () => {
    for (const u of [w.admin, w.fo]) {
      const res = await get('/api/v1/dashboard', u);
      expect(res.statusCode).toBe(200);
      const { stats } = res.json();
      expect(stats.invoices.totalValue).toBe(3000);
      expect(stats.invoices.outstanding).toBe(3000);
      expect(stats.invoices.total).toBe(2);
      expect(stats.budget.totalBudgeted).toBe(12000);
      expect(stats.budget.totalSpent).toBe(1500);
      expect(stats.budget.budgetsCount).toBe(2);
      expect(stats.labour.thisMonthCost).toBe(400);
    }
  });

  it('PM with canViewFinance gets money totals scoped to member projects', async () => {
    const res = await get('/api/v1/dashboard', w.pmFinMember);
    expect(res.statusCode).toBe(200);
    const { stats } = res.json();
    expect(stats.invoices.totalValue).toBe(1000);
    expect(stats.invoices.totalPaid).toBe(0);
    expect(stats.invoices.outstanding).toBe(1000);
    expect(stats.invoices.total).toBe(1);
    expect(stats.budget.totalBudgeted).toBe(5000);
    expect(stats.budget.totalSpent).toBe(1000);
    expect(stats.budget.totalRemaining).toBe(4000);
    expect(stats.budget.budgetsCount).toBe(1);
    expect(stats.labour.thisMonthCost).toBe(100);
  });

  it('PM with canViewFinance but removed membership gets zero money totals', async () => {
    const res = await get('/api/v1/dashboard', w.pmFinRemoved);
    expect(res.statusCode).toBe(200);
    const { stats } = res.json();
    expect(stats.invoices.totalValue).toBe(0);
    expect(stats.budget.totalBudgeted).toBe(0);
    expect(stats.labour.thisMonthCost).toBe(0);
  });

  it.each(DENIED)('%s gets 200 with money fields nulled and non-financial counts intact', async (_label, key) => {
    const user = w[key];
    const res = await get('/api/v1/dashboard', user);
    expect(res.statusCode).toBe(200);
    const { stats } = res.json();
    // Money fields withheld
    expect(stats.invoices.totalValue).toBeNull();
    expect(stats.invoices.totalPaid).toBeNull();
    expect(stats.invoices.outstanding).toBeNull();
    expect(stats.budget.totalBudgeted).toBeNull();
    expect(stats.budget.totalSpent).toBeNull();
    expect(stats.budget.totalRemaining).toBeNull();
    expect(stats.labour.thisMonthCost).toBeNull();
    expect(stats.finance).toBeUndefined();
    // Invoice / budget record counts are financial summaries too
    expect(stats.invoices.total).toBeNull();
    expect(stats.invoices.overdueCount).toBeNull();
    expect(stats.invoices.pendingApproval).toBeNull();
    expect(stats.budget.budgetsCount).toBeNull();
    expect(stats.budget.overspendCount).toBeNull();
    // Non-financial aggregates still work
    expect(typeof stats.projects.total).toBe('number');
    expect(typeof stats.labour.thisWeekHours).toBe('number');
    expect(typeof stats.notifications.unread).toBe('number');
    expect(typeof stats.deliveries.totalCount).toBe('number');
  });

  it('other tenant admin never sees company A money', async () => {
    const res = await get('/api/v1/dashboard', w.otherAdmin);
    expect(res.statusCode).toBe(200);
    const { stats } = res.json();
    expect(stats.invoices.totalValue).toBe(99999);
    expect(stats.budget.totalBudgeted).toBe(88888);
    expect(stats.labour.thisMonthCost).toBe(0);
  });
});

// ─── Financial WRITES ──────────────────────────────────────────────────────────
//
// Same scope as reads: nobody can create or edit a financial record they
// cannot read. CA/FO company-wide; PM only with canViewFinance on ACTIVE member
// projects (out of scope → 404); everyone else 403. Role-level rules that
// already existed (approve/pay/dispute/cancel/delete are CA/FO only) still 403.

function send(method: 'POST' | 'PATCH' | 'DELETE', url: string, user: TestUser, payload?: object) {
  return app.inject({
    method, url,
    headers: { authorization: `Bearer ${user.accessToken}` },
    ...(payload !== undefined ? { payload } : {}),
  });
}

let seq = 0;
async function freshInvoice(projectId: string, status: 'draft' | 'submitted' = 'draft') {
  const { companyId } = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  return createTestInvoice(companyId, projectId, {
    invoiceNumber: `FA-W-${++seq}-${Date.now()}`,
    totalAmount:   500,
    status,
    dueDate:       new Date('2027-12-31'), // future, so list calls never flip it to overdue
  });
}

function invoiceBody(projectId: string) {
  return {
    projectId,
    invoiceNumber: `FA-NEW-${++seq}-${Date.now()}`,
    vendorName:    'Write Vendor',
    vendorType:    'supplier',
    issueDate:     '2026-11-01',
    dueDate:       '2027-12-01',
    subtotal:      100,
    totalAmount:   100,
  };
}

// Users who must be denied every internal financial write with 403.
const WRITE_DENIED: Array<[string, UserKey]> = [
  ['PM without canViewFinance (member)', 'pmNoFinMember'],
  ['site_supervisor',                    'supervisor'],
  ['contractor',                         'contractor'],
  ['consultant',                         'consultant'],
  ['viewer',                             'viewer'],
  ['viewer with canViewFinance flag',    'viewerFinFlag'],
  ['worker',                             'worker'],
];

describe('Invoice writes — create', () => {
  it('company_admin and finance_officer can create on any company project', async () => {
    expect((await send('POST', '/api/v1/invoices', w.admin, invoiceBody(w.p2))).statusCode).toBe(201);
    expect((await send('POST', '/api/v1/invoices', w.fo,    invoiceBody(w.p1))).statusCode).toBe(201);
  });

  it('company_admin gets 404 creating on another tenant project', async () => {
    expect((await send('POST', '/api/v1/invoices', w.admin, invoiceBody(w.p3))).statusCode).toBe(404);
  });

  it('PM with canViewFinance can create on an active-member project only', async () => {
    expect((await send('POST', '/api/v1/invoices', w.pmFinMember,  invoiceBody(w.p1))).statusCode).toBe(201);
    expect((await send('POST', '/api/v1/invoices', w.pmFinMember,  invoiceBody(w.p2))).statusCode).toBe(404);
    expect((await send('POST', '/api/v1/invoices', w.pmFinMember,  invoiceBody(w.p3))).statusCode).toBe(404);
    expect((await send('POST', '/api/v1/invoices', w.pmFinRemoved, invoiceBody(w.p1))).statusCode).toBe(404);
    expect((await send('POST', '/api/v1/invoices', w.pmFinNone,    invoiceBody(w.p1))).statusCode).toBe(404);
  });

  it.each(WRITE_DENIED)('%s gets 403 and nothing is created', async (_label, key) => {
    const body = invoiceBody(w.p1);
    const res  = await send('POST', '/api/v1/invoices', w[key], body);
    expect(res.statusCode).toBe(403);
    expect(await prisma.invoice.count({ where: { invoiceNumber: body.invoiceNumber } })).toBe(0);
  });
});

describe('Invoice writes — update / submit / line items', () => {
  it('PM with canViewFinance can edit, submit and manage line items in scope', async () => {
    const inv = await freshInvoice(w.p1);
    expect((await send('PATCH', `/api/v1/invoices/${inv.id}`, w.pmFinMember, { notes: 'pm edit' })).statusCode).toBe(200);
    const li = await send('POST', `/api/v1/invoices/${inv.id}/line-items`, w.pmFinMember, { description: 'x', quantity: 1, unitRate: 10, amount: 10 });
    expect(li.statusCode).toBe(201);
    const lineItemId = li.json().invoice.lineItems[0].id as string;
    expect((await send('DELETE', `/api/v1/invoices/${inv.id}/line-items/${lineItemId}`, w.pmFinMember)).statusCode).toBe(204);
    expect((await send('POST', `/api/v1/invoices/${inv.id}/submit`, w.pmFinMember, {})).statusCode).toBe(200);
  });

  it('PM with canViewFinance gets 404 on out-of-scope invoices (non-member, removed, other tenant)', async () => {
    const invP2 = await freshInvoice(w.p2);
    const invP1 = await freshInvoice(w.p1);
    const invP3 = await freshInvoice(w.p3);
    expect((await send('PATCH', `/api/v1/invoices/${invP2.id}`, w.pmFinMember, { notes: 'x' })).statusCode).toBe(404);
    expect((await send('POST',  `/api/v1/invoices/${invP2.id}/submit`, w.pmFinMember, {})).statusCode).toBe(404);
    expect((await send('POST',  `/api/v1/invoices/${invP2.id}/line-items`, w.pmFinMember, { description: 'x', quantity: 1, unitRate: 1, amount: 1 })).statusCode).toBe(404);
    expect((await send('PATCH', `/api/v1/invoices/${invP3.id}`, w.pmFinMember, { notes: 'x' })).statusCode).toBe(404);
    expect((await send('PATCH', `/api/v1/invoices/${invP1.id}`, w.pmFinRemoved, { notes: 'x' })).statusCode).toBe(404);
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invP2.id } });
    expect(after.notes).toBeNull();
    expect(after.status).toBe('draft');
  });

  it.each(WRITE_DENIED)('%s gets 403 on edit / submit / line items and nothing changes', async (_label, key) => {
    const inv = await freshInvoice(w.p1);
    const li  = await prisma.invoiceLineItem.create({
      data: { invoiceId: inv.id, companyId: inv.companyId, description: 'seed', quantity: 1, unitRate: 1, amount: 1 },
    });
    expect((await send('PATCH',  `/api/v1/invoices/${inv.id}`, w[key], { notes: 'nope' })).statusCode).toBe(403);
    expect((await send('POST',   `/api/v1/invoices/${inv.id}/submit`, w[key], {})).statusCode).toBe(403);
    expect((await send('POST',   `/api/v1/invoices/${inv.id}/line-items`, w[key], { description: 'x', quantity: 1, unitRate: 1, amount: 1 })).statusCode).toBe(403);
    expect((await send('DELETE', `/api/v1/invoices/${inv.id}/line-items/${li.id}`, w[key])).statusCode).toBe(403);
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { lineItems: true } });
    expect(after.notes).toBeNull();
    expect(after.status).toBe('draft');
    expect(after.lineItems).toHaveLength(1);
  });
});

describe('Invoice writes — finance-only operations', () => {
  it('finance_officer / company_admin can approve, pay, remove payment, dispute, cancel and delete', async () => {
    const inv = await freshInvoice(w.p2, 'submitted');
    expect((await send('POST', `/api/v1/invoices/${inv.id}/approve`, w.fo, {})).statusCode).toBe(200);
    const pay = await send('POST', `/api/v1/invoices/${inv.id}/payments`, w.fo, { amount: 100, paymentDate: '2026-11-02', method: 'bank_transfer' });
    expect(pay.statusCode).toBe(201);
    expect((await send('DELETE', `/api/v1/invoices/${inv.id}/payments/${pay.json().payment.id}`, w.fo)).statusCode).toBe(204);
    expect((await send('POST', `/api/v1/invoices/${inv.id}/dispute`, w.fo, { notes: 'q' })).statusCode).toBe(200);
    expect((await send('POST', `/api/v1/invoices/${inv.id}/cancel`, w.admin, {})).statusCode).toBe(200);
    const draft = await freshInvoice(w.p2);
    expect((await send('DELETE', `/api/v1/invoices/${draft.id}`, w.admin)).statusCode).toBe(204);
  });

  it('every PM (even with canViewFinance, in scope) and every other role gets 403', async () => {
    const inv = await freshInvoice(w.p1, 'submitted');
    for (const u of [w.pmFinMember, w.pmNoFinMember, w.supervisor, w.contractor, w.consultant, w.viewer, w.viewerFinFlag, w.worker]) {
      expect((await send('POST',   `/api/v1/invoices/${inv.id}/approve`,  u, {})).statusCode).toBe(403);
      expect((await send('POST',   `/api/v1/invoices/${inv.id}/payments`, u, { amount: 1, paymentDate: '2026-11-02', method: 'cash' })).statusCode).toBe(403);
      expect((await send('POST',   `/api/v1/invoices/${inv.id}/dispute`,  u, {})).statusCode).toBe(403);
      expect((await send('POST',   `/api/v1/invoices/${inv.id}/cancel`,   u, {})).statusCode).toBe(403);
      expect((await send('DELETE', `/api/v1/invoices/${inv.id}`,          u)).statusCode).toBe(403);
    }
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('submitted');
  });
});

describe('Budget writes', () => {
  it('company_admin can create a budget on any company project; 404 cross-tenant', async () => {
    const p = await createTestProject(w.admin.companyId, 'FA admin budget project');
    expect((await send('POST', '/api/v1/budgets', w.admin, { projectId: p.id, name: 'A' })).statusCode).toBe(201);
    const pB = await createTestProject(w.otherAdmin.companyId, 'FA other tenant');
    expect((await send('POST', '/api/v1/budgets', w.admin, { projectId: pB.id, name: 'X' })).statusCode).toBe(404);
  });

  it('PM with canViewFinance can create only on an active-member project', async () => {
    const companyId = w.admin.companyId;
    const member    = await createTestProject(companyId, 'FA pm member project');
    const nonMember = await createTestProject(companyId, 'FA pm non-member project');
    await assignUserToProject(companyId, member.id, w.pmFinMember.id);
    expect((await send('POST', '/api/v1/budgets', w.pmFinMember, { projectId: nonMember.id, name: 'N' })).statusCode).toBe(404);
    expect((await send('POST', '/api/v1/budgets', w.pmFinMember, { projectId: member.id,    name: 'M' })).statusCode).toBe(201);
  });

  it.each(WRITE_DENIED)('%s cannot create a budget, even on a project they belong to', async (_label, key) => {
    const companyId = w.admin.companyId;
    const p = await createTestProject(companyId, `FA denied budget ${key}`);
    await assignUserToProject(companyId, p.id, w[key].id);
    expect((await send('POST', '/api/v1/budgets', w[key], { projectId: p.id, name: 'D' })).statusCode).toBe(403);
    expect(await prisma.budget.count({ where: { projectId: p.id } })).toBe(0);
  });

  it('PM with canViewFinance can edit / manage line items / variations in scope', async () => {
    expect((await send('PATCH', `/api/v1/budgets/${w.b1}`, w.pmFinMember, { notes: 'pm' })).statusCode).toBe(200);
    const li = await send('POST', `/api/v1/budgets/${w.b1}/line-items`, w.pmFinMember, { category: 'labour', description: 'pm li', budgetedAmount: 10 });
    expect(li.statusCode).toBe(201);
    const liId = li.json().lineItem.id as string;
    expect((await send('PATCH',  `/api/v1/budgets/${w.b1}/line-items/${liId}`, w.pmFinMember, { description: 'pm li 2' })).statusCode).toBe(200);
    expect((await send('DELETE', `/api/v1/budgets/${w.b1}/line-items/${liId}`, w.pmFinMember)).statusCode).toBe(204);
    const vo = await send('POST', `/api/v1/budgets/${w.b1}/variations`, w.pmFinMember, { referenceNumber: 'FA-VO-1', description: 'vo', amount: 5 });
    expect(vo.statusCode).toBe(201);
    expect((await send('PATCH', `/api/v1/budgets/${w.b1}/variations/${vo.json().variation.id}`, w.pmFinMember, { description: 'vo2' })).statusCode).toBe(200);
  });

  it('PM with canViewFinance gets 404 on out-of-scope budgets (incl. line-item delete)', async () => {
    const companyId = w.admin.companyId;
    const liB2 = await createTestLineItem(w.b2, companyId, w.p2, { budgetedAmount: 1 });
    expect((await send('PATCH',  `/api/v1/budgets/${w.b2}`, w.pmFinMember, { notes: 'x' })).statusCode).toBe(404);
    expect((await send('POST',   `/api/v1/budgets/${w.b2}/line-items`, w.pmFinMember, { category: 'labour', description: 'x', budgetedAmount: 1 })).statusCode).toBe(404);
    expect((await send('PATCH',  `/api/v1/budgets/${w.b2}/line-items/${liB2.id}`, w.pmFinMember, { description: 'x' })).statusCode).toBe(404);
    expect((await send('DELETE', `/api/v1/budgets/${w.b2}/line-items/${liB2.id}`, w.pmFinMember)).statusCode).toBe(404);
    expect((await send('POST',   `/api/v1/budgets/${w.b2}/variations`, w.pmFinMember, { referenceNumber: 'X', description: 'x', amount: 1 })).statusCode).toBe(404);
    expect((await send('PATCH',  `/api/v1/budgets/${w.b1}`, w.pmFinRemoved, { notes: 'x' })).statusCode).toBe(404);
    expect((await send('PATCH',  `/api/v1/budgets/${w.b3}`, w.pmFinMember, { notes: 'x' })).statusCode).toBe(404);
    expect(await prisma.budgetLineItem.count({ where: { id: liB2.id } })).toBe(1);
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: w.b2 } })).notes).toBeNull();
  });

  it('PM requester loses variation edit rights once membership is removed', async () => {
    const companyId = w.admin.companyId;
    const p  = await createTestProject(companyId, 'FA variation project');
    await assignUserToProject(companyId, p.id, w.pmFinMember.id);
    const b  = await createTestBudget(companyId, p.id);
    const vo = await send('POST', `/api/v1/budgets/${b.id}/variations`, w.pmFinMember, { referenceNumber: 'FA-VO-R', description: 'vo', amount: 5 });
    expect(vo.statusCode).toBe(201);
    await prisma.projectMember.updateMany({ where: { projectId: p.id, userId: w.pmFinMember.id }, data: { removedAt: new Date() } });
    expect((await send('PATCH', `/api/v1/budgets/${b.id}/variations/${vo.json().variation.id}`, w.pmFinMember, { description: 'late' })).statusCode).toBe(404);
  });

  it.each(WRITE_DENIED)('%s gets 403 on every budget write and nothing changes', async (_label, key) => {
    const companyId = w.admin.companyId;
    const u  = w[key];
    const li = await createTestLineItem(w.b1, companyId, w.p1, { budgetedAmount: 3 });
    const vo = await prisma.variationOrder.create({
      data: { budgetId: w.b1, companyId, projectId: w.p1, referenceNumber: `FA-SEED-${key}`, description: 'seed', amount: 1, requestedById: u.id },
    });
    expect((await send('PATCH',  `/api/v1/budgets/${w.b1}`, u, { notes: 'nope' })).statusCode).toBe(403);
    expect((await send('POST',   `/api/v1/budgets/${w.b1}/line-items`, u, { category: 'labour', description: 'x', budgetedAmount: 1 })).statusCode).toBe(403);
    expect((await send('PATCH',  `/api/v1/budgets/${w.b1}/line-items/${li.id}`, u, { description: 'x' })).statusCode).toBe(403);
    expect((await send('DELETE', `/api/v1/budgets/${w.b1}/line-items/${li.id}`, u)).statusCode).toBe(403);
    expect((await send('POST',   `/api/v1/budgets/${w.b1}/variations`, u, { referenceNumber: 'X', description: 'x', amount: 1 })).statusCode).toBe(403);
    // Even as the recorded requester of the variation
    expect((await send('PATCH',  `/api/v1/budgets/${w.b1}/variations/${vo.id}`, u, { description: 'x' })).statusCode).toBe(403);
    expect((await send('POST',   `/api/v1/budgets/${w.b1}/approve`, u, {})).statusCode).toBe(403);
    expect((await send('POST',   `/api/v1/budgets/${w.b1}/lock`, u, {})).statusCode).toBe(403);
    expect((await send('DELETE', `/api/v1/budgets/${w.b1}`, u)).statusCode).toBe(403);
    expect(await prisma.budgetLineItem.count({ where: { id: li.id } })).toBe(1);
    expect((await prisma.variationOrder.findUniqueOrThrow({ where: { id: vo.id } })).description).toBe('seed');
    expect((await prisma.budget.findUniqueOrThrow({ where: { id: w.b1 } })).notes).not.toBe('nope');
  });

  it('PM with canViewFinance still cannot approve / lock / delete (existing role rule)', async () => {
    expect((await send('POST',   `/api/v1/budgets/${w.b1}/approve`, w.pmFinMember, {})).statusCode).toBe(403);
    expect((await send('POST',   `/api/v1/budgets/${w.b1}/lock`,    w.pmFinMember, {})).statusCode).toBe(403);
    expect((await send('DELETE', `/api/v1/budgets/${w.b1}`,         w.pmFinMember)).statusCode).toBe(403);
  });

  it('finance_officer can approve, lock and delete company budgets', async () => {
    const companyId = w.admin.companyId;
    const p = await createTestProject(companyId, 'FA fo budget project');
    const b = await createTestBudget(companyId, p.id);
    expect((await send('POST',   `/api/v1/budgets/${b.id}/approve`, w.fo, {})).statusCode).toBe(200);
    expect((await send('POST',   `/api/v1/budgets/${b.id}/lock`,    w.fo, {})).statusCode).toBe(200);
    const p2 = await createTestProject(companyId, 'FA fo delete project');
    const b2 = await createTestBudget(companyId, p2.id);
    expect((await send('DELETE', `/api/v1/budgets/${b2.id}`, w.fo)).statusCode).toBe(204);
  });
});
