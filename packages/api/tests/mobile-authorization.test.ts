/**
 * Mobile global list read-authorization (S5).
 *
 * GET /api/v1/labour and GET /api/v1/deliveries must be limited to the caller's
 * read scope: company-wide roles (company_admin, finance_officer) see every
 * project in their company; other roles only projects with an active
 * ProjectMember row; site_supervisor only assigned sites. An out-of-scope
 * projectId / siteId (other company, non-member project, unassigned site, or a
 * site outside the supplied project) returns 404.
 *
 * Labour wage fields (dailyRate, currency) are financial: returned only to
 * company_admin / finance_officer and to project_manager with canViewFinance.
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

interface World {
  admin:          TestUser;
  finance:        TestUser;
  pm:             TestUser; // member of P1, canViewFinance = false
  pmFin:          TestUser; // member of P1, canViewFinance = true
  pmNoMember:     TestUser;
  supervisor:     TestUser; // member of P1, site S1a only
  supervisorOpen: TestUser; // member of P1, all sites
  p1: TestProject;
  p2: TestProject;
  s1a: TestSite;
  s1b: TestSite;
  s2: TestSite;
  otherProject: TestProject;
  otherSite:    TestSite;
}

async function buildWorld(): Promise<World> {
  const { company, admin } = await createTestCompany(app, 'mauth-a');
  const { company: other, admin: otherAdmin } = await createTestCompany(app, 'mauth-b');

  const p1  = await createTestProject(company.id, 'Project One');
  const p2  = await createTestProject(company.id, 'Project Two');
  const s1a = await createTestSite(company.id, p1.id, 'Site 1A');
  const s1b = await createTestSite(company.id, p1.id, 'Site 1B');
  const s2  = await createTestSite(company.id, p2.id, 'Site 2');
  const otherProject = await createTestProject(other.id, 'Other Project');
  const otherSite    = await createTestSite(other.id, otherProject.id, 'Other Site');

  const finance        = await createTestUser(app, company.id, 'finance_officer', 'mauth-fo');
  const pm             = await createTestUser(app, company.id, 'project_manager', 'mauth-pm');
  const pmFin          = await createTestUser(app, company.id, 'project_manager', 'mauth-pm-fin', { canViewFinance: true });
  const pmNoMember     = await createTestUser(app, company.id, 'project_manager', 'mauth-pm-nm');
  const supervisor     = await createTestUser(app, company.id, 'site_supervisor', 'mauth-ss');
  const supervisorOpen = await createTestUser(app, company.id, 'site_supervisor', 'mauth-ss-open');

  await assignUserToProject(company.id, p1.id, pm.id);
  await assignUserToProject(company.id, p1.id, pmFin.id);
  await assignUserToProject(company.id, p1.id, supervisor.id, s1a.id);
  await assignUserToProject(company.id, p1.id, supervisorOpen.id);

  const date = new Date('2026-04-07');
  const w1a = await createTestWorker(company.id, { firstName: 'Worker', lastName: 'OneA' });
  const w1b = await createTestWorker(company.id, { firstName: 'Worker', lastName: 'OneB' });
  const w2  = await createTestWorker(company.id, { firstName: 'Worker', lastName: 'Two' });
  const wo  = await createTestWorker(other.id,   { firstName: 'Worker', lastName: 'Other' });
  await createTestLabourEntry(company.id, p1.id, s1a.id, w1a.id, admin.id, { date });
  await createTestLabourEntry(company.id, p1.id, s1b.id, w1b.id, admin.id, { date });
  await createTestLabourEntry(company.id, p2.id, s2.id,  w2.id,  admin.id, { date });
  await createTestLabourEntry(other.id, otherProject.id, otherSite.id, wo.id, otherAdmin.id, { date });

  await createTestDelivery(company.id, p1.id, s1a.id, admin.id, { supplierName: 'Supplier-1A' });
  await createTestDelivery(company.id, p1.id, s1b.id, admin.id, { supplierName: 'Supplier-1B' });
  await createTestDelivery(company.id, p2.id, s2.id,  admin.id, { supplierName: 'Supplier-2' });
  await createTestDelivery(other.id, otherProject.id, otherSite.id, otherAdmin.id, { supplierName: 'Supplier-Other' });

  return {
    admin, finance, pm, pmFin, pmNoMember, supervisor, supervisorOpen,
    p1, p2, s1a, s1b, s2, otherProject, otherSite,
  };
}

async function get(user: TestUser, path: string, query: Record<string, string> = {}) {
  const qs = new URLSearchParams(query).toString();
  return app.inject({
    method:  'GET',
    url:     `/api/v1/${path}${qs ? `?${qs}` : ''}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
}

type LabourBody   = { entries: Array<{ worker: { lastName: string } }>; pagination: { total: number } };
type DeliveryBody = { records: Array<{ supplierName: string }>;          pagination: { total: number } };

const labourNames = (res: { json: () => LabourBody }) =>
  res.json().entries.map((e) => e.worker.lastName).sort();
const suppliers = (res: { json: () => DeliveryBody }) =>
  res.json().records.map((r) => r.supplierName).sort();

// ─── GET /api/v1/labour ───────────────────────────────────────────────────────

describe('GET /api/v1/labour — authorization matrix', () => {
  it('company_admin sees all own-company labour only', async () => {
    const w = await buildWorld();
    const res = await get(w.admin, 'labour');
    expect(res.statusCode).toBe(200);
    expect(labourNames(res)).toEqual(['OneA', 'OneB', 'Two']);
  });

  it('finance_officer sees all own-company labour', async () => {
    const w = await buildWorld();
    const res = await get(w.finance, 'labour');
    expect(res.statusCode).toBe(200);
    expect(labourNames(res)).toEqual(['OneA', 'OneB', 'Two']);
  });

  it('project_manager sees only member-project labour, and total reflects scope', async () => {
    const w = await buildWorld();
    const res = await get(w.pm, 'labour');
    expect(res.statusCode).toBe(200);
    expect(labourNames(res)).toEqual(['OneA', 'OneB']);
    expect(res.json().pagination.total).toBe(2);
  });

  it('project_manager with no memberships sees nothing', async () => {
    const w = await buildWorld();
    const res = await get(w.pmNoMember, 'labour');
    expect(res.statusCode).toBe(200);
    expect(res.json().pagination.total).toBe(0);
  });

  it('project_manager gets 404 for a non-member projectId', async () => {
    const w = await buildWorld();
    const res = await get(w.pm, 'labour', { projectId: w.p2.id });
    expect(res.statusCode).toBe(404);
  });

  it('project_manager gets 404 for a siteId in a non-member project', async () => {
    const w = await buildWorld();
    const res = await get(w.pm, 'labour', { siteId: w.s2.id });
    expect(res.statusCode).toBe(404);
  });

  it('site_supervisor sees only assigned-site labour', async () => {
    const w = await buildWorld();
    const res = await get(w.supervisor, 'labour');
    expect(res.statusCode).toBe(200);
    expect(labourNames(res)).toEqual(['OneA']);
  });

  it('site_supervisor gets 404 for an unassigned site', async () => {
    const w = await buildWorld();
    const res = await get(w.supervisor, 'labour', { siteId: w.s1b.id });
    expect(res.statusCode).toBe(404);
  });

  it('site_supervisor with open membership sees all sites of member project', async () => {
    const w = await buildWorld();
    const res = await get(w.supervisorOpen, 'labour');
    expect(res.statusCode).toBe(200);
    expect(labourNames(res)).toEqual(['OneA', 'OneB']);
  });

  it('siteId outside projectId returns 404 (company_admin)', async () => {
    const w = await buildWorld();
    const res = await get(w.admin, 'labour', { projectId: w.p1.id, siteId: w.s2.id });
    expect(res.statusCode).toBe(404);
  });

  it('cross-tenant projectId / siteId return 404 (company_admin)', async () => {
    const w = await buildWorld();
    expect((await get(w.admin, 'labour', { projectId: w.otherProject.id })).statusCode).toBe(404);
    expect((await get(w.admin, 'labour', { siteId: w.otherSite.id })).statusCode).toBe(404);
  });
});

// ─── GET /api/v1/labour — wage fields ─────────────────────────────────────────

describe('GET /api/v1/labour — wage / rate fields', () => {
  type Entry = Record<string, unknown> & { hoursWorked: unknown };
  const entriesOf = (res: { json: () => { entries: Entry[] } }) => res.json().entries;

  function expectNoWages(entries: Entry[]) {
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(e).not.toHaveProperty('dailyRate');
      expect(e).not.toHaveProperty('currency');
      expect(Number(e.hoursWorked)).toBe(8);
    }
  }
  function expectWages(entries: Entry[]) {
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(Number(e.dailyRate)).toBe(1500);
  }

  it('site_supervisor (assigned site) sees hours but no rates', async () => {
    const w = await buildWorld();
    const res = await get(w.supervisor, 'labour');
    expect(res.statusCode).toBe(200);
    expectNoWages(entriesOf(res));
    expect(res.json().financialFieldsIncluded).toBe(false);
  });

  it('project_manager without canViewFinance sees no rates', async () => {
    const w = await buildWorld();
    const res = await get(w.pm, 'labour');
    expect(res.statusCode).toBe(200);
    expectNoWages(entriesOf(res));
  });

  it('project_manager with canViewFinance sees rates on member projects only', async () => {
    const w = await buildWorld();
    const res = await get(w.pmFin, 'labour');
    expect(res.statusCode).toBe(200);
    expect(labourNames(res)).toEqual(['OneA', 'OneB']);
    expectWages(entriesOf(res));
    expect(res.json().financialFieldsIncluded).toBe(true);
  });

  it('project_manager with canViewFinance gets 404 for a non-member project', async () => {
    const w = await buildWorld();
    const res = await get(w.pmFin, 'labour', { projectId: w.p2.id });
    expect(res.statusCode).toBe(404);
  });

  it('company_admin and finance_officer see rates', async () => {
    const w = await buildWorld();
    expectWages(entriesOf(await get(w.admin, 'labour')));
    expectWages(entriesOf(await get(w.finance, 'labour')));
  });

  it('cross-tenant projectId returns 404 (finance_officer)', async () => {
    const w = await buildWorld();
    const res = await get(w.finance, 'labour', { projectId: w.otherProject.id });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /api/v1/deliveries ───────────────────────────────────────────────────

describe('GET /api/v1/deliveries — authorization matrix', () => {
  it('company_admin sees all own-company deliveries only', async () => {
    const w = await buildWorld();
    const res = await get(w.admin, 'deliveries');
    expect(res.statusCode).toBe(200);
    expect(suppliers(res)).toEqual(['Supplier-1A', 'Supplier-1B', 'Supplier-2']);
  });

  it('finance_officer sees all own-company deliveries', async () => {
    const w = await buildWorld();
    const res = await get(w.finance, 'deliveries');
    expect(res.statusCode).toBe(200);
    expect(suppliers(res)).toEqual(['Supplier-1A', 'Supplier-1B', 'Supplier-2']);
  });

  it('project_manager sees only member-project deliveries, and total reflects scope', async () => {
    const w = await buildWorld();
    const res = await get(w.pm, 'deliveries');
    expect(res.statusCode).toBe(200);
    expect(suppliers(res)).toEqual(['Supplier-1A', 'Supplier-1B']);
    expect(res.json().pagination.total).toBe(2);
  });

  it('project_manager with no memberships sees nothing', async () => {
    const w = await buildWorld();
    const res = await get(w.pmNoMember, 'deliveries');
    expect(res.statusCode).toBe(200);
    expect(res.json().pagination.total).toBe(0);
  });

  it('project_manager gets 404 for a non-member projectId', async () => {
    const w = await buildWorld();
    const res = await get(w.pm, 'deliveries', { projectId: w.p2.id });
    expect(res.statusCode).toBe(404);
  });

  it('site_supervisor sees only assigned-site deliveries', async () => {
    const w = await buildWorld();
    const res = await get(w.supervisor, 'deliveries');
    expect(res.statusCode).toBe(200);
    expect(suppliers(res)).toEqual(['Supplier-1A']);
  });

  it('site_supervisor gets 404 for an unassigned site', async () => {
    const w = await buildWorld();
    const res = await get(w.supervisor, 'deliveries', { projectId: w.p1.id, siteId: w.s1b.id });
    expect(res.statusCode).toBe(404);
  });

  it('siteId outside projectId returns 404 (company_admin)', async () => {
    const w = await buildWorld();
    const res = await get(w.admin, 'deliveries', { projectId: w.p1.id, siteId: w.s2.id });
    expect(res.statusCode).toBe(404);
  });

  it('cross-tenant projectId / siteId return 404 (company_admin)', async () => {
    const w = await buildWorld();
    expect((await get(w.admin, 'deliveries', { projectId: w.otherProject.id })).statusCode).toBe(404);
    expect((await get(w.admin, 'deliveries', { siteId: w.otherSite.id })).statusCode).toBe(404);
  });
});
