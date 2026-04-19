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
  createTestAttendanceRecord,
  createTestDelivery,
  createTestContractor,
  createTestInvoice,
  createTestBudget,
  createTestLineItem,
  createTestNotification,
  createTestInstruction,
  clearDatabase,
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

// ─── GET /dashboard ────────────────────────────────────────────────────────────

describe('GET /dashboard', () => {
  it('returns 200 with stats for authenticated user', async () => {
    const { admin } = await createTestCompany(app, 'dash-basic');

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/dashboard',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { stats } = res.json();
    expect(stats).toBeDefined();
    expect(stats.projects).toBeDefined();
    expect(stats.workers).toBeDefined();
    expect(stats.invoices).toBeDefined();
    expect(stats.budget).toBeDefined();
    expect(stats.deliveries).toBeDefined();
    expect(stats.contractors).toBeDefined();
    expect(stats.instructions).toBeDefined();
    expect(stats.notifications).toBeDefined();
  });

  it('returns 401 without authentication', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/dashboard',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns correct project counts', async () => {
    const { company, admin } = await createTestCompany(app, 'dash-projects');
    await createTestProject(company.id, 'Active Project 1');
    await createTestProject(company.id, 'Active Project 2');
    await prisma.project.create({ data: { companyId: company.id, name: 'Completed P', status: 'completed' } });
    await prisma.project.create({ data: { companyId: company.id, name: 'On Hold P',  status: 'on_hold' } });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/dashboard',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { stats } = res.json();
    expect(stats.projects.total).toBe(4);
    expect(stats.projects.active).toBe(2);
    expect(stats.projects.completed).toBe(1);
    expect(stats.projects.onHold).toBe(1);
  });

  it('returns up to 5 recent projects', async () => {
    const { company, admin } = await createTestCompany(app, 'dash-recent');
    for (let i = 1; i <= 7; i++) {
      await createTestProject(company.id, `Project ${i}`);
    }

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/dashboard',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().stats.projects.recent).toHaveLength(5);
  });

  it('returns correct worker counts', async () => {
    const { company, admin } = await createTestCompany(app, 'dash-workers');
    await createTestWorker(company.id, { isActive: true });
    await createTestWorker(company.id, { isActive: true });
    await createTestWorker(company.id, { isActive: false });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/dashboard',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const { stats } = res.json();
    expect(stats.workers.total).toBe(3);
    expect(stats.workers.active).toBe(2);
  });

  it('returns correct invoice stats', async () => {
    const { company, admin } = await createTestCompany(app, 'dash-invoices');
    const project = await createTestProject(company.id);
    await createTestInvoice(company.id, project.id, { totalAmount: 50000, status: 'approved' });
    await createTestInvoice(company.id, project.id, { totalAmount: 20000, status: 'submitted' });
    await createTestInvoice(company.id, project.id, { totalAmount: 10000, status: 'overdue' });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/dashboard',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const { invoices } = res.json().stats;
    expect(invoices.total).toBe(3);
    expect(invoices.totalValue).toBe(80000);
    expect(invoices.overdueCount).toBe(1);
    expect(invoices.pendingApproval).toBe(1);
  });

  it('returns correct budget stats', async () => {
    const { company, admin } = await createTestCompany(app, 'dash-budget');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);
    await createTestLineItem(budget.id, company.id, project.id, { budgetedAmount: 100000, actualSpend: 40000 });
    await createTestLineItem(budget.id, company.id, project.id, { budgetedAmount: 50000,  actualSpend: 60000 }); // overspend

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/dashboard',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const { budget: b } = res.json().stats;
    expect(b.totalBudgeted).toBe(150000);
    expect(b.totalSpent).toBe(100000);
    expect(b.totalRemaining).toBe(50000);
    expect(b.budgetsCount).toBe(1);
    expect(b.overspendCount).toBe(1);
  });

  it('returns correct delivery stats', async () => {
    const { company, admin } = await createTestCompany(app, 'dash-deliveries');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const now     = new Date();
    await createTestDelivery(company.id, project.id, site.id, admin.id, { deliveryDate: now });
    await createTestDelivery(company.id, project.id, site.id, admin.id, { deliveryDate: now });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/dashboard',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const { deliveries } = res.json().stats;
    expect(deliveries.totalCount).toBe(2);
    expect(deliveries.thisMonthCount).toBe(2);
    expect(deliveries.pendingInspectionCount).toBe(2); // default inspectionStatus is 'pending'
  });

  it('returns correct notification unread count', async () => {
    const { company, admin } = await createTestCompany(app, 'dash-notifs');
    await createTestNotification(company.id, admin.id, { isRead: false });
    await createTestNotification(company.id, admin.id, { isRead: false });
    await createTestNotification(company.id, admin.id, { isRead: true });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/dashboard',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.json().stats.notifications.unread).toBe(2);
  });

  it('returns correct instruction stats', async () => {
    const { company, admin } = await createTestCompany(app, 'dash-instructions');
    const project = await createTestProject(company.id);
    await createTestInstruction(company.id, project.id, admin.id, { status: 'open', priority: 'critical' });
    await createTestInstruction(company.id, project.id, admin.id, { status: 'open',     priority: 'medium' });
    await createTestInstruction(company.id, project.id, admin.id, { status: 'resolved', priority: 'critical' });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/dashboard',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const { instructions } = res.json().stats;
    expect(instructions.open).toBe(2);     // open + open
    expect(instructions.critical).toBe(1); // only unresolved critical
  });

  it('includes finance stats for company_admin with canViewFinance', async () => {
    const { company, admin } = await createTestCompany(app, 'dash-finance');
    const project = await createTestProject(company.id);
    await prisma.financeInflow.create({
      data: {
        companyId:       company.id,
        projectId:       project.id,
        sourceType:      'sales_revenue',
        sourceName:      'Unit Sales',
        amount:          500000,
        currency:        'USD',
        transactionDate: new Date(),
        recordedById:    admin.id,
      },
    });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/dashboard',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const { stats } = res.json();
    expect(stats.finance).toBeDefined();
    expect(stats.finance.totalInflows).toBe(500000);
    expect(stats.finance.inflowsThisMonth).toBe(500000);
  });

  it('does not include finance stats for non-finance user', async () => {
    const { company } = await createTestCompany(app, 'dash-no-finance');
    const pm = await createTestUser(app, company.id, 'project_manager', 'dash-no-finance-pm');

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/dashboard',
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().stats.finance).toBeUndefined();
  });

  it('does not return other companies data', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'dash-iso-1');
    const { company: c2 }            = await createTestCompany(app, 'dash-iso-2');
    const proj2 = await createTestProject(c2.id, 'Other Co Project');
    await createTestInvoice(c2.id, proj2.id, { totalAmount: 999999 });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/dashboard',
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    const { stats } = res.json();
    expect(stats.projects.total).toBe(0);
    expect(stats.invoices.total).toBe(0);
    expect(stats.invoices.totalValue).toBe(0);
  });

  it('returns correct attendance stats for today', async () => {
    const { company, admin } = await createTestCompany(app, 'dash-attendance');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const w1      = await createTestWorker(company.id);
    const w2      = await createTestWorker(company.id);
    const w3      = await createTestWorker(company.id);
    const today   = new Date();

    await createTestAttendanceRecord(company.id, project.id, site.id, w1.id, admin.id, { date: today, status: 'present' });
    await createTestAttendanceRecord(company.id, project.id, site.id, w2.id, admin.id, { date: today, status: 'present' });
    await createTestAttendanceRecord(company.id, project.id, site.id, w3.id, admin.id, { date: today, status: 'absent'  });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/dashboard',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const { attendance } = res.json().stats;
    expect(attendance.todayTotal).toBe(3);
    expect(attendance.todayPresent).toBe(2);
    expect(attendance.todayRate).toBe(67);
  });
});
