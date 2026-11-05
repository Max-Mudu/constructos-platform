/**
 * Report read-authorization matrix (S4).
 *
 * Verifies GET /api/v1/reports/:type enforces, on top of the REPORT_ROLES gate:
 *   - tenant isolation (another company's projectId / siteId -> 404)
 *   - project membership for non-company-wide roles (non-member project -> 404,
 *     no projectId -> only member projects)
 *   - site must belong to the project / company (else 404)
 *   - site_supervisor limited to assigned sites
 *   - financial reports (invoices, budget, project-health): company_admin /
 *     finance_officer company-wide; project_manager only with canViewFinance AND
 *     only member projects; contractor / consultant / site_supervisor never -
 *     even for invoices that reference their own contractor record
 * and that csv/xlsx/pdf exports produce the same authorization outcome as json.
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
  createTestDelivery,
  createTestContractor,
  createTestInvoice,
  createTestBudget,
  createTestLineItem,
  createTestInstruction,
  assignUserToProject,
  clearDatabase,
  TestUser,
  TestProject,
  TestSite,
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

// ─── World ────────────────────────────────────────────────────────────────────

interface World {
  admin:        TestUser;
  finance:      TestUser;
  pm:           TestUser; // member of P1 only, canViewFinance = false (default)
  pmFin:        TestUser; // member of P1 only, canViewFinance = true
  pmNoMember:   TestUser; // no memberships, canViewFinance = true
  supervisor:   TestUser; // member of P1, site-scoped to S1a
  supervisorOpen: TestUser; // member of P1, no site restriction
  contractor:   TestUser; // member of P1, linked to Contractor C1
  contractorUnlinked: TestUser; // member of P1, no Contractor record
  consultant:   TestUser; // member of P1, consultantUser on INV-CONS
  p1: TestProject;
  p2: TestProject;
  s1a: TestSite;
  s1b: TestSite;
  s2: TestSite;
  otherAdmin:   TestUser;
  otherProject: TestProject;
  otherSite:    TestSite;
}

const REPORT_DATE = '2026-04-07';

async function buildWorld(): Promise<World> {
  const { company, admin } = await createTestCompany(app, 'rauth-a');
  const { company: other, admin: otherAdmin } = await createTestCompany(app, 'rauth-b');

  const p1  = await createTestProject(company.id, 'Project One');
  const p2  = await createTestProject(company.id, 'Project Two');
  const s1a = await createTestSite(company.id, p1.id, 'Site 1A');
  const s1b = await createTestSite(company.id, p1.id, 'Site 1B');
  const s2  = await createTestSite(company.id, p2.id, 'Site 2');

  const otherProject = await createTestProject(other.id, 'Other Project');
  const otherSite    = await createTestSite(other.id, otherProject.id, 'Other Site');

  const finance            = await createTestUser(app, company.id, 'finance_officer', 'rauth-fo', { canViewFinance: true });
  const pm                 = await createTestUser(app, company.id, 'project_manager', 'rauth-pm');
  const pmFin              = await createTestUser(app, company.id, 'project_manager', 'rauth-pm-fin', { canViewFinance: true });
  const pmNoMember         = await createTestUser(app, company.id, 'project_manager', 'rauth-pm-nm', { canViewFinance: true });
  const supervisor         = await createTestUser(app, company.id, 'site_supervisor', 'rauth-ss');
  const supervisorOpen     = await createTestUser(app, company.id, 'site_supervisor', 'rauth-ss-open');
  const contractor         = await createTestUser(app, company.id, 'contractor', 'rauth-ctr');
  const contractorUnlinked = await createTestUser(app, company.id, 'contractor', 'rauth-ctr-nl');
  const consultant         = await createTestUser(app, company.id, 'consultant', 'rauth-cons');

  await assignUserToProject(company.id, p1.id, pm.id);
  await assignUserToProject(company.id, p1.id, pmFin.id);
  await assignUserToProject(company.id, p1.id, supervisor.id, s1a.id);
  await assignUserToProject(company.id, p1.id, supervisorOpen.id);
  await assignUserToProject(company.id, p1.id, contractor.id);
  await assignUserToProject(company.id, p1.id, contractorUnlinked.id);
  await assignUserToProject(company.id, p1.id, consultant.id);

  // Labour — one distinctly-named worker per site
  const w1a = await createTestWorker(company.id, { firstName: 'Worker', lastName: 'OneA' });
  const w1b = await createTestWorker(company.id, { firstName: 'Worker', lastName: 'OneB' });
  const w2  = await createTestWorker(company.id, { firstName: 'Worker', lastName: 'Two' });
  const wo  = await createTestWorker(other.id,   { firstName: 'Worker', lastName: 'Other' });
  const date = new Date(REPORT_DATE);
  await createTestLabourEntry(company.id, p1.id, s1a.id, w1a.id, admin.id, { date });
  await createTestLabourEntry(company.id, p1.id, s1b.id, w1b.id, admin.id, { date });
  await createTestLabourEntry(company.id, p2.id, s2.id,  w2.id,  admin.id, { date });
  await createTestLabourEntry(other.id, otherProject.id, otherSite.id, wo.id, otherAdmin.id, { date });

  // Deliveries — supplier name identifies the site
  await createTestDelivery(company.id, p1.id, s1a.id, admin.id, { supplierName: 'Supplier-1A', deliveryDate: date });
  await createTestDelivery(company.id, p1.id, s1b.id, admin.id, { supplierName: 'Supplier-1B', deliveryDate: date });
  await createTestDelivery(company.id, p2.id, s2.id,  admin.id, { supplierName: 'Supplier-2',  deliveryDate: date });
  await createTestDelivery(other.id, otherProject.id, otherSite.id, otherAdmin.id, { supplierName: 'Supplier-Other', deliveryDate: date });

  // Contractors / invoices
  const c1 = await createTestContractor(company.id, 'Contractor Own', contractor.id);
  const c2 = await createTestContractor(company.id, 'Contractor Other');
  await createTestInvoice(company.id, p1.id, { invoiceNumber: 'INV-P1-OWN',   contractorId: c1.id });
  await createTestInvoice(company.id, p1.id, { invoiceNumber: 'INV-P1-OTHER', contractorId: c2.id });
  await createTestInvoice(company.id, p2.id, { invoiceNumber: 'INV-P2-OWN',   contractorId: c1.id });
  await createTestInvoice(company.id, p1.id, {
    invoiceNumber: 'INV-P1-CONS', vendorType: 'consultant', consultantUserId: consultant.id,
  });
  await createTestInvoice(other.id, otherProject.id, { invoiceNumber: 'INV-OTHER-CO' });

  // Budgets
  const b1 = await createTestBudget(company.id, p1.id, { name: 'Budget P1' });
  const b2 = await createTestBudget(company.id, p2.id, { name: 'Budget P2' });
  const bo = await createTestBudget(other.id, otherProject.id, { name: 'Budget Other' });
  await createTestLineItem(b1.id, company.id, p1.id);
  await createTestLineItem(b2.id, company.id, p2.id);
  await createTestLineItem(bo.id, other.id, otherProject.id);

  // Instructions
  await createTestInstruction(company.id, p1.id, admin.id, { title: 'Instr P1' });
  await createTestInstruction(company.id, p2.id, admin.id, { title: 'Instr P2' });

  return {
    admin, finance, pm, pmFin, pmNoMember, supervisor, supervisorOpen,
    contractor, contractorUnlinked, consultant,
    p1, p2, s1a, s1b, s2, otherAdmin, otherProject, otherSite,
  };
}

async function report(
  user: TestUser,
  type: string,
  query: Record<string, string> = {},
) {
  const qs = new URLSearchParams(query).toString();
  return app.inject({
    method:  'GET',
    url:     `/api/v1/reports/${type}${qs ? `?${qs}` : ''}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
}

function rows(res: { json: () => { report: { rows: string[][] } } }): string[][] {
  return res.json().report.rows;
}

function col(res: { json: () => { report: { rows: string[][] } } }, idx: number): string[] {
  return rows(res).map((r) => r[idx]).sort();
}

// ─── Invoices (financial) ─────────────────────────────────────────────────────

describe('reports/invoices — authorization matrix', () => {
  it('company_admin sees every invoice in own company only', async () => {
    const w = await buildWorld();
    const res = await report(w.admin, 'invoices');
    expect(res.statusCode).toBe(200);
    expect(col(res, 0)).toEqual(['INV-P1-CONS', 'INV-P1-OTHER', 'INV-P1-OWN', 'INV-P2-OWN']);
  });

  it('finance_officer sees every invoice in own company', async () => {
    const w = await buildWorld();
    const res = await report(w.finance, 'invoices');
    expect(res.statusCode).toBe(200);
    expect(col(res, 0)).toEqual(['INV-P1-CONS', 'INV-P1-OTHER', 'INV-P1-OWN', 'INV-P2-OWN']);
  });

  it('project_manager without canViewFinance is denied (403) even on a member project', async () => {
    const w = await buildWorld();
    expect((await report(w.pm, 'invoices')).statusCode).toBe(403);
    const res = await report(w.pm, 'invoices', { projectId: w.p1.id });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FINANCE_ACCESS_DENIED');
  });

  it('project_manager with canViewFinance sees only invoices of member projects', async () => {
    const w = await buildWorld();
    const res = await report(w.pmFin, 'invoices');
    expect(res.statusCode).toBe(200);
    expect(col(res, 0)).toEqual(['INV-P1-CONS', 'INV-P1-OTHER', 'INV-P1-OWN']);
  });

  it('project_manager with canViewFinance gets 404 for a non-member project', async () => {
    const w = await buildWorld();
    const res = await report(w.pmFin, 'invoices', { projectId: w.p2.id });
    expect(res.statusCode).toBe(404);
  });

  it('project_manager with canViewFinance but no memberships sees no invoices', async () => {
    const w = await buildWorld();
    const res = await report(w.pmNoMember, 'invoices');
    expect(res.statusCode).toBe(200);
    expect(rows(res)).toHaveLength(0);
  });

  it('contractor is denied (403) even though invoices reference their own contractor record', async () => {
    const w = await buildWorld();
    expect((await report(w.contractor, 'invoices')).statusCode).toBe(403);
    expect((await report(w.contractor, 'invoices', { projectId: w.p1.id })).statusCode).toBe(403);
    expect((await report(w.contractorUnlinked, 'invoices')).statusCode).toBe(403);
  });

  it('consultant is denied (403) even for invoices naming them as consultant user', async () => {
    const w = await buildWorld();
    expect((await report(w.consultant, 'invoices')).statusCode).toBe(403);
  });

  it('site_supervisor is denied by role (403)', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisor, 'invoices');
    expect(res.statusCode).toBe(403);
  });

  it('cross-tenant projectId returns 404 even for company_admin', async () => {
    const w = await buildWorld();
    const res = await report(w.admin, 'invoices', { projectId: w.otherProject.id });
    expect(res.statusCode).toBe(404);
  });

  it('cross-tenant siteId returns 404 even for company_admin', async () => {
    const w = await buildWorld();
    const res = await report(w.admin, 'invoices', { siteId: w.otherSite.id });
    expect(res.statusCode).toBe(404);
  });

  it('CSV export: contractor denied (403), no invoice data in body', async () => {
    const w = await buildWorld();
    const res = await report(w.contractor, 'invoices', { format: 'csv' });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('INV-P1-OWN');
  });

  it('CSV export: PM without canViewFinance denied (403) like JSON', async () => {
    const w = await buildWorld();
    const res = await report(w.pm, 'invoices', { format: 'csv' });
    expect(res.statusCode).toBe(403);
  });

  it('CSV export: PM with canViewFinance contains only member-project invoices', async () => {
    const w = await buildWorld();
    const res = await report(w.pmFin, 'invoices', { format: 'csv' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('INV-P1-OWN');
    expect(res.body).not.toContain('INV-P2-OWN');
  });

  it('PDF export for PM on a non-member project returns 404 like JSON', async () => {
    const w = await buildWorld();
    const res = await report(w.pmFin, 'invoices', { projectId: w.p2.id, format: 'pdf' });
    expect(res.statusCode).toBe(404);
  });

  it('XLSX export for PM on a non-member project returns 404 like JSON', async () => {
    const w = await buildWorld();
    const res = await report(w.pmFin, 'invoices', { projectId: w.p2.id, format: 'xlsx' });
    expect(res.statusCode).toBe(404);
  });

  it('audit-logs finance denials and successful financial report access', async () => {
    const w = await buildWorld();
    await report(w.pm, 'invoices');
    await report(w.finance, 'invoices');
    const denied = await prisma.auditLog.findFirst({
      where: { userId: w.pm.id, action: 'permission_denied', entityType: 'finance', entityId: 'report:invoices' },
    });
    const viewed = await prisma.auditLog.findFirst({
      where: { userId: w.finance.id, action: 'view_finance', entityType: 'finance', entityId: 'report:invoices' },
    });
    expect(denied).not.toBeNull();
    expect(viewed).not.toBeNull();
  });
});

// ─── Labour ───────────────────────────────────────────────────────────────────

describe('reports/labour — authorization matrix', () => {
  const WORKER = 1;

  it('company_admin sees every labour entry in own company', async () => {
    const w = await buildWorld();
    const res = await report(w.admin, 'labour');
    expect(res.statusCode).toBe(200);
    expect(col(res, WORKER)).toEqual(['Worker OneA', 'Worker OneB', 'Worker Two']);
  });

  it('finance_officer sees every labour entry in own company', async () => {
    const w = await buildWorld();
    const res = await report(w.finance, 'labour');
    expect(res.statusCode).toBe(200);
    expect(rows(res)).toHaveLength(3);
  });

  it('project_manager (no finance flag) sees only member-project labour', async () => {
    // Labour keeps its role gate (no canViewFinance check): wage columns are an open owner decision.
    const w = await buildWorld();
    const res = await report(w.pm, 'labour');
    expect(res.statusCode).toBe(200);
    expect(col(res, WORKER)).toEqual(['Worker OneA', 'Worker OneB']);
  });

  it('project_manager gets 404 for a non-member project', async () => {
    const w = await buildWorld();
    const res = await report(w.pm, 'labour', { projectId: w.p2.id });
    expect(res.statusCode).toBe(404);
  });

  it('project_manager gets 404 for a site of a non-member project', async () => {
    const w = await buildWorld();
    const res = await report(w.pm, 'labour', { siteId: w.s2.id });
    expect(res.statusCode).toBe(404);
  });

  it('site_supervisor sees only assigned-site labour', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisor, 'labour');
    expect(res.statusCode).toBe(200);
    expect(col(res, WORKER)).toEqual(['Worker OneA']);
  });

  it('site_supervisor scoped to member project sees only assigned sites', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisor, 'labour', { projectId: w.p1.id });
    expect(res.statusCode).toBe(200);
    expect(col(res, WORKER)).toEqual(['Worker OneA']);
  });

  it('site_supervisor gets 404 for an unassigned site in a member project', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisor, 'labour', { projectId: w.p1.id, siteId: w.s1b.id });
    expect(res.statusCode).toBe(404);
  });

  it('site_supervisor with an unrestricted membership sees all sites of the project', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisorOpen, 'labour');
    expect(res.statusCode).toBe(200);
    expect(col(res, WORKER)).toEqual(['Worker OneA', 'Worker OneB']);
  });

  it('siteId that does not belong to projectId returns 404 (company_admin)', async () => {
    const w = await buildWorld();
    const res = await report(w.admin, 'labour', { projectId: w.p1.id, siteId: w.s2.id });
    expect(res.statusCode).toBe(404);
  });

  it('cross-tenant projectId returns 404', async () => {
    const w = await buildWorld();
    const res = await report(w.admin, 'labour', { projectId: w.otherProject.id });
    expect(res.statusCode).toBe(404);
  });

  it('CSV export for site_supervisor on an unassigned site returns 404 like JSON', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisor, 'labour', { siteId: w.s1b.id, format: 'csv' });
    expect(res.statusCode).toBe(404);
  });

  it('CSV export for site_supervisor contains only assigned-site labour', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisor, 'labour', { format: 'csv' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('OneA');
    expect(res.body).not.toContain('OneB');
    expect(res.body).not.toContain('Worker Two');
  });
});

// ─── Labour wages (financial fields) ──────────────────────────────────────────

describe('reports/labour — wage / rate / cost fields', () => {
  type LabourReport = {
    report: { columns: string[]; rows: string[][]; summary: Array<{ label: string; value: string }> };
  };
  const FIN_COLUMNS = ['Daily Rate', 'Currency'];

  function expectNoWages(res: { json: () => LabourReport }) {
    const { columns, rows: r, summary } = res.json().report;
    for (const c of FIN_COLUMNS) expect(columns).not.toContain(c);
    expect(columns).toEqual(expect.arrayContaining(['Date', 'Worker', 'Trade', 'Hours']));
    expect(summary.map((s) => s.label)).not.toContain('Total Cost');
    expect(summary.map((s) => s.label)).toContain('Total Hours');
    for (const row of r) {
      expect(row).toHaveLength(columns.length);
      expect(row).not.toContain('1500.00');
    }
  }

  function expectWages(res: { json: () => LabourReport }) {
    const { columns, rows: r, summary } = res.json().report;
    expect(columns).toEqual(expect.arrayContaining(['Hours', 'Daily Rate', 'Currency']));
    expect(summary.map((s) => s.label)).toContain('Total Cost');
    const rateIdx = columns.indexOf('Daily Rate');
    for (const row of r) expect(row[rateIdx]).toBe('1500.00');
  }

  it('site_supervisor (assigned site) sees hours but no rates or cost', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisor, 'labour');
    expect(res.statusCode).toBe(200);
    expect(rows(res)).toHaveLength(1);
    expectNoWages(res);
    const hoursIdx = res.json().report.columns.indexOf('Hours');
    expect(rows(res)[0][hoursIdx]).toBe('8.0');
  });

  it('project_manager without canViewFinance sees no rates or cost', async () => {
    const w = await buildWorld();
    const res = await report(w.pm, 'labour');
    expect(res.statusCode).toBe(200);
    expect(rows(res)).toHaveLength(2);
    expectNoWages(res);
  });

  it('project_manager with canViewFinance sees rates on member projects only', async () => {
    const w = await buildWorld();
    const res = await report(w.pmFin, 'labour');
    expect(res.statusCode).toBe(200);
    expect(col(res, 1)).toEqual(['Worker OneA', 'Worker OneB']);
    expectWages(res);
  });

  it('project_manager with canViewFinance gets 404 for a non-member project', async () => {
    const w = await buildWorld();
    const res = await report(w.pmFin, 'labour', { projectId: w.p2.id });
    expect(res.statusCode).toBe(404);
  });

  it('project_manager with canViewFinance but no memberships gets an empty report', async () => {
    const w = await buildWorld();
    const res = await report(w.pmNoMember, 'labour');
    expect(res.statusCode).toBe(200);
    expect(rows(res)).toHaveLength(0);
  });

  it('company_admin and finance_officer see rates and cost', async () => {
    const w = await buildWorld();
    const a = await report(w.admin, 'labour');
    const f = await report(w.finance, 'labour');
    expect(a.statusCode).toBe(200);
    expect(f.statusCode).toBe(200);
    expectWages(a);
    expectWages(f);
    expect(rows(f)).toHaveLength(3);
  });

  it('cross-tenant projectId returns 404 (finance_officer)', async () => {
    const w = await buildWorld();
    const res = await report(w.finance, 'labour', { projectId: w.otherProject.id });
    expect(res.statusCode).toBe(404);
  });

  it('CSV export for site_supervisor has no rate column or values', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisor, 'labour', { format: 'csv' });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('Daily Rate');
    expect(res.body).not.toContain('Total Cost');
    expect(res.body).not.toContain('1500');
    expect(res.body).toContain('OneA');
  });

  it('CSV export for PM with canViewFinance includes the rate column', async () => {
    const w = await buildWorld();
    const res = await report(w.pmFin, 'labour', { format: 'csv' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Daily Rate');
    expect(res.body).toContain('1500.00');
  });
});

// ─── Daily site report ────────────────────────────────────────────────────────

describe('reports/daily-site-report — authorization matrix', () => {
  const q = (projectId: string, siteId: string) => ({ projectId, siteId, startDate: REPORT_DATE });

  it('site_supervisor can pull the report for an assigned site', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisor, 'daily-site-report', q(w.p1.id, w.s1a.id));
    expect(res.statusCode).toBe(200);
  });

  it('site_supervisor gets 404 for an unassigned site in a member project', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisor, 'daily-site-report', q(w.p1.id, w.s1b.id));
    expect(res.statusCode).toBe(404);
  });

  it('site_supervisor gets 404 for a non-member project', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisor, 'daily-site-report', q(w.p2.id, w.s2.id));
    expect(res.statusCode).toBe(404);
  });

  it('project_manager can pull any site of a member project', async () => {
    const w = await buildWorld();
    const res = await report(w.pm, 'daily-site-report', q(w.p1.id, w.s1b.id));
    expect(res.statusCode).toBe(200);
  });

  it('project_manager gets 404 for a non-member project', async () => {
    const w = await buildWorld();
    const res = await report(w.pm, 'daily-site-report', q(w.p2.id, w.s2.id));
    expect(res.statusCode).toBe(404);
  });

  it('finance_officer can pull any company site', async () => {
    const w = await buildWorld();
    const res = await report(w.finance, 'daily-site-report', q(w.p2.id, w.s2.id));
    expect(res.statusCode).toBe(200);
  });

  it('siteId outside projectId returns 404 (company_admin)', async () => {
    const w = await buildWorld();
    const res = await report(w.admin, 'daily-site-report', q(w.p1.id, w.s2.id));
    expect(res.statusCode).toBe(404);
  });

  it('cross-tenant project/site returns 404 (company_admin)', async () => {
    const w = await buildWorld();
    const res = await report(w.admin, 'daily-site-report', q(w.otherProject.id, w.otherSite.id));
    expect(res.statusCode).toBe(404);
  });

  it('PDF export for PM on a non-member project returns 404 like JSON', async () => {
    const w = await buildWorld();
    const res = await report(w.pm, 'daily-site-report', { ...q(w.p2.id, w.s2.id), format: 'pdf' });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Budget ───────────────────────────────────────────────────────────────────

describe('reports/budget — authorization matrix', () => {
  const PROJECT = 0;

  it('company_admin sees every budget in own company', async () => {
    const w = await buildWorld();
    const res = await report(w.admin, 'budget');
    expect(res.statusCode).toBe(200);
    expect(col(res, PROJECT)).toEqual(['Project One', 'Project Two']);
  });

  it('finance_officer sees every budget in own company', async () => {
    const w = await buildWorld();
    const res = await report(w.finance, 'budget');
    expect(res.statusCode).toBe(200);
    expect(col(res, PROJECT)).toEqual(['Project One', 'Project Two']);
  });

  it('project_manager without canViewFinance is denied (403)', async () => {
    const w = await buildWorld();
    expect((await report(w.pm, 'budget')).statusCode).toBe(403);
    expect((await report(w.pm, 'budget', { projectId: w.p1.id, format: 'csv' })).statusCode).toBe(403);
  });

  it('project_manager with canViewFinance sees only member-project budgets', async () => {
    const w = await buildWorld();
    const res = await report(w.pmFin, 'budget');
    expect(res.statusCode).toBe(200);
    expect(col(res, PROJECT)).toEqual(['Project One']);
  });

  it('project_manager with canViewFinance gets 404 for a non-member project', async () => {
    const w = await buildWorld();
    const res = await report(w.pmFin, 'budget', { projectId: w.p2.id });
    expect(res.statusCode).toBe(404);
  });

  it('cross-tenant projectId returns 404', async () => {
    const w = await buildWorld();
    const res = await report(w.admin, 'budget', { projectId: w.otherProject.id });
    expect(res.statusCode).toBe(404);
  });

  it('contractor, consultant and site_supervisor are denied by role (403)', async () => {
    const w = await buildWorld();
    expect((await report(w.contractor, 'budget')).statusCode).toBe(403);
    expect((await report(w.consultant, 'budget')).statusCode).toBe(403);
    expect((await report(w.supervisor, 'budget')).statusCode).toBe(403);
  });
});

// ─── Deliveries ───────────────────────────────────────────────────────────────

describe('reports/deliveries — authorization matrix', () => {
  const SUPPLIER = 3;

  it('company_admin sees every delivery in own company', async () => {
    const w = await buildWorld();
    const res = await report(w.admin, 'deliveries');
    expect(res.statusCode).toBe(200);
    expect(col(res, SUPPLIER)).toEqual(['Supplier-1A', 'Supplier-1B', 'Supplier-2']);
  });

  it('project_manager sees only member-project deliveries', async () => {
    const w = await buildWorld();
    const res = await report(w.pm, 'deliveries');
    expect(res.statusCode).toBe(200);
    expect(col(res, SUPPLIER)).toEqual(['Supplier-1A', 'Supplier-1B']);
  });

  it('project_manager gets 404 for a non-member project', async () => {
    const w = await buildWorld();
    const res = await report(w.pm, 'deliveries', { projectId: w.p2.id });
    expect(res.statusCode).toBe(404);
  });

  it('site_supervisor sees only assigned-site deliveries', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisor, 'deliveries');
    expect(res.statusCode).toBe(200);
    expect(col(res, SUPPLIER)).toEqual(['Supplier-1A']);
  });

  it('site_supervisor gets 404 for an unassigned site', async () => {
    const w = await buildWorld();
    const res = await report(w.supervisor, 'deliveries', { siteId: w.s1b.id });
    expect(res.statusCode).toBe(404);
  });

  it('cross-tenant siteId returns 404', async () => {
    const w = await buildWorld();
    const res = await report(w.admin, 'deliveries', { siteId: w.otherSite.id });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Remaining report types ───────────────────────────────────────────────────

describe('reports/project-health (financial), consultants, contractors — scoping', () => {
  it('project-health: project_manager without canViewFinance is denied (403)', async () => {
    const w = await buildWorld();
    expect((await report(w.pm, 'project-health')).statusCode).toBe(403);
  });

  it('project-health: project_manager with canViewFinance sees only member projects', async () => {
    const w = await buildWorld();
    const res = await report(w.pmFin, 'project-health');
    expect(res.statusCode).toBe(200);
    expect(col(res, 0)).toEqual(['Project One']);
  });

  it('project-health: project_manager with canViewFinance gets 404 for a non-member project', async () => {
    const w = await buildWorld();
    const res = await report(w.pmFin, 'project-health', { projectId: w.p2.id });
    expect(res.statusCode).toBe(404);
  });

  it('project-health: finance_officer sees all company projects', async () => {
    const w = await buildWorld();
    const res = await report(w.finance, 'project-health');
    expect(res.statusCode).toBe(200);
    expect(col(res, 0)).toEqual(['Project One', 'Project Two']);
  });

  it('consultants: consultant sees only member-project instructions', async () => {
    const w = await buildWorld();
    const res = await report(w.consultant, 'consultants');
    expect(res.statusCode).toBe(200);
    expect(rows(res).map((r) => r[3])).toEqual(['Instr P1']);
  });

  it('consultants: consultant gets 404 for a non-member project', async () => {
    const w = await buildWorld();
    const res = await report(w.consultant, 'consultants', { projectId: w.p2.id });
    expect(res.statusCode).toBe(404);
  });

  it('contractors: project_manager gets 404 for a non-member project', async () => {
    const w = await buildWorld();
    const res = await report(w.pm, 'contractors', { projectId: w.p2.id });
    expect(res.statusCode).toBe(404);
  });

  it('contractors: cross-tenant projectId returns 404', async () => {
    const w = await buildWorld();
    const res = await report(w.admin, 'contractors', { projectId: w.otherProject.id });
    expect(res.statusCode).toBe(404);
  });
});
