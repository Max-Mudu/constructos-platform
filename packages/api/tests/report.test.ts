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
  createTestDelivery,
  createTestContractor,
  createTestInvoice,
  createTestBudget,
  createTestLineItem,
  createTestInstruction,
  assignWorkerToSite,
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

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe('GET /reports/:type — authentication', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/reports/labour' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for unknown report type', async () => {
    const { admin } = await createTestCompany(app, 'rpt-unknown');
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/nonexistent',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 422 for invalid format param', async () => {
    const { admin } = await createTestCompany(app, 'rpt-fmt');
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/labour?format=docx',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(res.statusCode).toBe(422);
  });
});

// ─── Labour report ────────────────────────────────────────────────────────────

describe('GET /reports/labour', () => {
  it('returns 200 with JSON by default', async () => {
    const { admin } = await createTestCompany(app, 'rpt-lab-basic');
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/labour',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.report).toBeDefined();
    expect(body.report.title).toBe('Labour Report');
    expect(Array.isArray(body.report.columns)).toBe(true);
    expect(Array.isArray(body.report.rows)).toBe(true);
    expect(Array.isArray(body.report.summary)).toBe(true);
  });

  it('returns 403 for worker role', async () => {
    const { company } = await createTestCompany(app, 'rpt-lab-worker');
    const worker = await createTestUser(app, company.id, 'worker', 'rpt-lab-worker');
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/labour',
      headers: { authorization: `Bearer ${worker.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns correct row count for labour entries', async () => {
    const { company, admin } = await createTestCompany(app, 'rpt-lab-rows');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);

    await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id, { date: new Date('2026-04-10') });
    await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id, { date: new Date('2026-04-11') });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/labour',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().report.rows).toHaveLength(2);
  });

  it('returns CSV with correct content-type', async () => {
    const { admin } = await createTestCompany(app, 'rpt-lab-csv');
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/labour?format=csv',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('labour-report.csv');
  });

  it('returns XLSX with correct content-type', async () => {
    const { admin } = await createTestCompany(app, 'rpt-lab-xlsx');
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/labour?format=xlsx',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('labour-report.xlsx');
  });

  it('returns PDF with correct content-type', async () => {
    const { admin } = await createTestCompany(app, 'rpt-lab-pdf');
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/labour?format=pdf',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('labour-report.pdf');
  });

  it('filters by date range', async () => {
    const { company, admin } = await createTestCompany(app, 'rpt-lab-dates');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);

    // Entry in range
    await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id, {
      date: new Date('2026-01-15'),
    });
    // Entry out of range
    await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id, {
      date: new Date('2025-06-01'),
    });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/labour?startDate=2026-01-01&endDate=2026-01-31',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().report.rows).toHaveLength(1);
  });

  it('does not return other company data', async () => {
    const { company: c2, admin: a2 } = await createTestCompany(app, 'rpt-lab-iso2');
    const { admin: a1 }              = await createTestCompany(app, 'rpt-lab-iso1');
    const project = await createTestProject(c2.id);
    const site    = await createTestSite(c2.id, project.id);
    const worker  = await createTestWorker(c2.id);
    await assignWorkerToSite(c2.id, project.id, site.id, worker.id, a2.id);
    await createTestLabourEntry(c2.id, project.id, site.id, worker.id, a2.id);

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/labour',
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.json().report.rows).toHaveLength(0);
  });
});

// ─── Budget report ────────────────────────────────────────────────────────────

describe('GET /reports/budget', () => {
  it('returns 200 with correct summary', async () => {
    const { company, admin } = await createTestCompany(app, 'rpt-bud');
    const project = await createTestProject(company.id);
    const budget  = await createTestBudget(company.id, project.id);
    await createTestLineItem(budget.id, company.id, project.id, { budgetedAmount: 100000, actualSpend: 40000 });
    await createTestLineItem(budget.id, company.id, project.id, { budgetedAmount: 50000, actualSpend: 60000 });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/budget',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { report } = res.json();
    expect(report.rows).toHaveLength(2);
    const summaryMap: Record<string, string> = {};
    for (const s of report.summary) summaryMap[s.label] = s.value;
    expect(summaryMap['Total Budgeted']).toBe('150000.00');
    expect(summaryMap['Total Spent']).toBe('100000.00');
    expect(summaryMap['Total Remaining']).toBe('50000.00');
  });

  it('returns 403 for contractor role', async () => {
    const { company } = await createTestCompany(app, 'rpt-bud-403');
    const user = await createTestUser(app, company.id, 'contractor', 'rpt-bud-403');
    const res  = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/budget',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('filters by projectId', async () => {
    const { company, admin } = await createTestCompany(app, 'rpt-bud-proj');
    const p1 = await createTestProject(company.id, 'Project 1');
    const p2 = await createTestProject(company.id, 'Project 2');
    const b1 = await createTestBudget(company.id, p1.id);
    const b2 = await createTestBudget(company.id, p2.id);
    await createTestLineItem(b1.id, company.id, p1.id);
    await createTestLineItem(b1.id, company.id, p1.id);
    await createTestLineItem(b2.id, company.id, p2.id);

    const res = await app.inject({
      method:  'GET',
      url:     `/api/v1/reports/budget?projectId=${p1.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().report.rows).toHaveLength(2);
  });
});

// ─── Invoice report ───────────────────────────────────────────────────────────

describe('GET /reports/invoices', () => {
  it('returns correct invoice summary', async () => {
    const { company, admin } = await createTestCompany(app, 'rpt-inv');
    const project = await createTestProject(company.id);
    await createTestInvoice(company.id, project.id, { totalAmount: 50000, status: 'approved' });
    await createTestInvoice(company.id, project.id, { totalAmount: 20000, status: 'submitted' });
    await createTestInvoice(company.id, project.id, { totalAmount: 10000, status: 'overdue' });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/invoices',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { report } = res.json();
    expect(report.rows).toHaveLength(3);
    const summaryMap: Record<string, string> = {};
    for (const s of report.summary) summaryMap[s.label] = s.value;
    expect(summaryMap['Total Invoices']).toBe('3');
    expect(summaryMap['Total Value']).toBe('80000.00');
    expect(summaryMap['Overdue']).toBe('1');
  });

  it('contractor role can access invoice report', async () => {
    const { company } = await createTestCompany(app, 'rpt-inv-ctr');
    const user = await createTestUser(app, company.id, 'contractor', 'rpt-inv-ctr');
    const res  = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/invoices',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('site_supervisor cannot access invoice report', async () => {
    const { company } = await createTestCompany(app, 'rpt-inv-ss');
    const user = await createTestUser(app, company.id, 'site_supervisor', 'rpt-inv-ss');
    const res  = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/invoices',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── Delivery report ──────────────────────────────────────────────────────────

describe('GET /reports/deliveries', () => {
  it('returns delivery rows and summary', async () => {
    const { company, admin } = await createTestCompany(app, 'rpt-del');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await createTestDelivery(company.id, project.id, site.id, admin.id);
    await createTestDelivery(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/deliveries',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { report } = res.json();
    expect(report.rows).toHaveLength(2);
    const summaryMap: Record<string, string> = {};
    for (const s of report.summary) summaryMap[s.label] = s.value;
    expect(summaryMap['Total Deliveries']).toBe('2');
    expect(summaryMap['Pending Inspection']).toBe('2'); // default is 'pending'
  });

  it('worker role cannot access delivery report', async () => {
    const { company } = await createTestCompany(app, 'rpt-del-403');
    const user = await createTestUser(app, company.id, 'worker', 'rpt-del-403');
    const res  = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/deliveries',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── Contractor report ────────────────────────────────────────────────────────

describe('GET /reports/contractors', () => {
  it('returns contractors and summary', async () => {
    const { company, admin } = await createTestCompany(app, 'rpt-ctr');
    await createTestContractor(company.id, 'Contractor A');
    await createTestContractor(company.id, 'Contractor B');

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/contractors',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { report } = res.json();
    expect(report.rows).toHaveLength(2);
    const summaryMap: Record<string, string> = {};
    for (const s of report.summary) summaryMap[s.label] = s.value;
    expect(summaryMap['Total Contractors']).toBe('2');
  });

  it('consultant role cannot access contractor report', async () => {
    const { company } = await createTestCompany(app, 'rpt-ctr-403');
    const user = await createTestUser(app, company.id, 'consultant', 'rpt-ctr-403');
    const res  = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/contractors',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── Consultant report ────────────────────────────────────────────────────────

describe('GET /reports/consultants', () => {
  it('returns instruction rows and summary', async () => {
    const { company, admin } = await createTestCompany(app, 'rpt-cons');
    const project = await createTestProject(company.id);
    await createTestInstruction(company.id, project.id, admin.id, { status: 'open',     priority: 'critical' });
    await createTestInstruction(company.id, project.id, admin.id, { status: 'open',     priority: 'medium' });
    await createTestInstruction(company.id, project.id, admin.id, { status: 'resolved', priority: 'critical' });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/consultants',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { report } = res.json();
    expect(report.rows).toHaveLength(3);
    const summaryMap: Record<string, string> = {};
    for (const s of report.summary) summaryMap[s.label] = s.value;
    expect(summaryMap['Open']).toBe('2');
    expect(summaryMap['Critical']).toBe('1');   // only unresolved critical
    expect(summaryMap['Resolved']).toBe('1');
  });

  it('consultant role can access consultant report', async () => {
    const { company } = await createTestCompany(app, 'rpt-cons-ok');
    const user = await createTestUser(app, company.id, 'consultant', 'rpt-cons-ok');
    const res  = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/consultants',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('contractor role cannot access consultant report', async () => {
    const { company } = await createTestCompany(app, 'rpt-cons-403');
    const user = await createTestUser(app, company.id, 'contractor', 'rpt-cons-403');
    const res  = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/consultants',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── Project health report ────────────────────────────────────────────────────

describe('GET /reports/project-health', () => {
  it('returns project rows with budget and invoice data', async () => {
    const { company, admin } = await createTestCompany(app, 'rpt-ph');
    const project = await createTestProject(company.id, 'Test Project');
    const budget  = await createTestBudget(company.id, project.id);
    await createTestLineItem(budget.id, company.id, project.id, { budgetedAmount: 100000, actualSpend: 40000 });
    await createTestInvoice(company.id, project.id, { totalAmount: 25000 });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/project-health',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { report } = res.json();
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0][0]).toBe('Test Project');
    // Invoice count column
    const invIdx = report.columns.indexOf('Invoices');
    expect(report.rows[0][invIdx]).toBe('1');
  });

  it('site_supervisor cannot access project health report', async () => {
    const { company } = await createTestCompany(app, 'rpt-ph-403');
    const user = await createTestUser(app, company.id, 'site_supervisor', 'rpt-ph-403');
    const res  = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/project-health',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('filters to single project when projectId provided', async () => {
    const { company, admin } = await createTestCompany(app, 'rpt-ph-proj');
    const p1 = await createTestProject(company.id, 'Alpha');
    await createTestProject(company.id, 'Beta');

    const res = await app.inject({
      method:  'GET',
      url:     `/api/v1/reports/project-health?projectId=${p1.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().report.rows).toHaveLength(1);
    expect(res.json().report.rows[0][0]).toBe('Alpha');
  });

  it('does not return other company projects', async () => {
    const { admin: a1 }    = await createTestCompany(app, 'rpt-ph-iso1');
    const { company: c2 }  = await createTestCompany(app, 'rpt-ph-iso2');
    await createTestProject(c2.id, 'Other Company Project');

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/reports/project-health',
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.json().report.rows).toHaveLength(0);
  });
});

// ─── Format consistency ───────────────────────────────────────────────────────

describe('Report format consistency', () => {
  it('every JSON report has required fields', async () => {
    const { admin } = await createTestCompany(app, 'rpt-struct');
    const types = ['labour', 'budget', 'invoices', 'deliveries', 'contractors', 'consultants', 'project-health'];

    for (const type of types) {
      const res = await app.inject({
        method:  'GET',
        url:     `/api/v1/reports/${type}`,
        headers: { authorization: `Bearer ${admin.accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const { report } = res.json();
      expect(typeof report.title).toBe('string');
      expect(typeof report.subtitle).toBe('string');
      expect(typeof report.generatedAt).toBe('string');
      expect(typeof report.filters).toBe('object');
      expect(Array.isArray(report.summary)).toBe(true);
      expect(Array.isArray(report.columns)).toBe(true);
      expect(Array.isArray(report.rows)).toBe(true);
    }
  });
});
