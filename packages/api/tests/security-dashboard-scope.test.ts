/**
 * GET /dashboard — every figure is limited to the caller's read scope.
 *
 *  - company-wide roles (super_admin, company_admin, finance_officer): the
 *    whole company (exact counts below);
 *  - project_manager / viewer / consultant: their active member projects;
 *  - site_supervisor: their assigned sites;
 *  - contractor: member projects, and only their own contractor-linked records;
 *  - worker: their own projects, attendance and labour; other figures zero;
 *  - another company's data never appears;
 *  - the response shape is the same for every role.
 */
import { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestWorker,
  assignUserToProject,
  assignWorkerToSite,
  createTestLabourEntry,
  createTestAttendanceRecord,
  createTestDelivery,
  createTestContractor,
  createTestScheduleTask,
  createTestInstruction,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

// Noon today: a calendar date that is "today" in local time and in UTC storage.
const today = new Date();
today.setHours(12, 0, 0, 0);

interface World {
  p1: { id: string; name: string };
  p2: { id: string; name: string };
  pb: { id: string; name: string };
  users: Record<string, TestUser>;
}
let w: World;

async function seedSite(
  companyId: string,
  projectId: string,
  siteName: string,
  recorderId: string,
  opts: { hours: number; attendance: 'present' | 'absent'; contractorId: string; critical?: boolean; instructionContractorId?: string },
) {
  const site = await createTestSite(companyId, projectId, siteName);
  const worker = await createTestWorker(companyId, { firstName: `W-${siteName}` });
  await assignWorkerToSite(companyId, projectId, site.id, worker.id, recorderId);
  await createTestAttendanceRecord(companyId, projectId, site.id, worker.id, recorderId, { date: today, status: opts.attendance });
  await createTestLabourEntry(companyId, projectId, site.id, worker.id, recorderId, { date: today, hoursWorked: opts.hours, dailyRate: 100 });
  await createTestDelivery(companyId, projectId, site.id, recorderId, { deliveryDate: today, itemDescription: `Delivery ${siteName}` });
  const task = await createTestScheduleTask(companyId, projectId, site.id, opts.contractorId, recorderId, undefined, `Task ${siteName}`);
  await prisma.scheduleTask.update({ where: { id: task.id }, data: { status: 'blocked' } });
  await createTestInstruction(companyId, projectId, recorderId, {
    siteId: site.id,
    title: `Instruction ${siteName}`,
    ...(opts.critical && { priority: 'critical' as const }),
    ...(opts.instructionContractorId && { contractorId: opts.instructionContractorId }),
  });
  await prisma.siteInventory.create({
    data: {
      companyId,
      siteId: site.id,
      materialName: `Material ${siteName}`,
      unitOfMeasure: 'bags',
      currentQuantity: 1,
      lowStockThreshold: 5,
    },
  });
  return { site, worker };
}

async function schedule(companyId: string, projectId: string, contractorId: string) {
  await prisma.contractorSchedule.create({
    data: {
      companyId, projectId, contractorId,
      scopeOfWork: 'Works', startDate: new Date('2026-01-01'), endDate: new Date('2027-01-01'),
      status: 'active',
    },
  });
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const { company: a, admin } = await createTestCompany(app, 'dscope-a');
  const { company: b, admin: adminB } = await createTestCompany(app, 'dscope-b');

  const mk = (role: UserRole, suffix: string) => createTestUser(app, a.id, role, `dscope-${suffix}`);
  const users: Record<string, TestUser> = {
    admin,
    adminB,
    superAdmin: await mk('super_admin', 'sa'),
    fo:         await mk('finance_officer', 'fo'),
    pm:         await mk('project_manager', 'pm'),
    viewer:     await mk('viewer', 'viewer'),
    consultant: await mk('consultant', 'consultant'),
    sup:        await mk('site_supervisor', 'sup'),
    contractor: await mk('contractor', 'contractor'),
    worker:     await mk('worker', 'worker'),
    workerNone: await mk('worker', 'worker-none'),
    pmRemoved:  await mk('project_manager', 'pm-removed'),
  };

  const p1 = await createTestProject(a.id, 'Alpha P1');
  const p2 = await createTestProject(a.id, 'Bravo P2');
  const pb = await createTestProject(b.id, 'Zulu B');

  const c1  = await createTestContractor(a.id, 'Contractor One', users.contractor!.id);
  const c1b = await createTestContractor(a.id, 'Contractor One-B');
  const c2  = await createTestContractor(a.id, 'Contractor Two');
  const cb  = await createTestContractor(b.id, 'Contractor Zulu');
  await schedule(a.id, p1.id, c1.id);
  await schedule(a.id, p2.id, c2.id);
  await schedule(b.id, pb.id, cb.id);

  const s1a = await seedSite(a.id, p1.id, 'S1a', admin.id, { hours: 9, attendance: 'present', contractorId: c1.id, instructionContractorId: c1.id });
  await seedSite(a.id, p1.id, 'S1b', admin.id, { hours: 5, attendance: 'absent', contractorId: c1b.id });
  await seedSite(a.id, p2.id, 'S2', admin.id, { hours: 10, attendance: 'present', contractorId: c2.id, critical: true });
  await seedSite(b.id, pb.id, 'SB', adminB.id, { hours: 11, attendance: 'present', contractorId: cb.id });
  // A worker record with no assignment (company-wide count only)
  await createTestWorker(a.id, { firstName: 'Unassigned' });

  await assignUserToProject(a.id, p1.id, users.pm!.id);
  await assignUserToProject(a.id, p1.id, users.viewer!.id);
  await assignUserToProject(a.id, p2.id, users.consultant!.id);
  await assignUserToProject(a.id, p1.id, users.sup!.id, s1a.site.id);
  await assignUserToProject(a.id, p1.id, users.contractor!.id);
  await assignUserToProject(a.id, p1.id, users.worker!.id);
  await prisma.worker.update({ where: { id: s1a.worker.id }, data: { userId: users.worker!.id } });
  await assignUserToProject(a.id, p2.id, users.pmRemoved!.id);
  await prisma.projectMember.updateMany({ where: { userId: users.pmRemoved!.id }, data: { removedAt: new Date() } });

  w = { p1, p2, pb, users };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

async function dash(key: string) {
  const res = await app.inject({
    method: 'GET',
    url: '/api/v1/dashboard',
    headers: { authorization: `Bearer ${w.users[key]!.accessToken}` },
  });
  expect(res.statusCode).toBe(200);
  return { stats: res.json().stats, raw: res.body };
}

interface Expected {
  projects: string[];
  workers: number;
  attTotal: number;
  attPresent: number;
  hours: number;
  overtime: number;
  deliveries: number;
  contractors: number;
  activeSchedules: number;
  instructions: number;
  critical: number;
  lowStock: number;
  blocked: number;
}

function expectFigures(stats: any, e: Expected) {
  expect(stats.projects.total).toBe(e.projects.length);
  expect(stats.projects.active).toBe(e.projects.length);
  expect(stats.projects.recent.map((p: { name: string }) => p.name).sort()).toEqual([...e.projects].sort());
  expect(stats.workers).toEqual({ total: e.workers, active: e.workers });
  expect(stats.attendance.todayTotal).toBe(e.attTotal);
  expect(stats.attendance.todayPresent).toBe(e.attPresent);
  expect(stats.labourAlerts.absentToday).toBe(e.attTotal - e.attPresent);
  expect(stats.labour.thisWeekHours).toBe(e.hours);
  expect(stats.labourAlerts.overtimeEntriesToday).toBe(e.overtime);
  expect(stats.deliveries).toEqual({ thisMonthCount: e.deliveries, pendingInspectionCount: e.deliveries, totalCount: e.deliveries });
  expect(stats.procurementAlerts.pendingDeliveriesCount).toBe(e.deliveries);
  expect(stats.contractors).toEqual({ total: e.contractors, activeSchedules: e.activeSchedules });
  expect(stats.instructions).toEqual({ open: e.instructions, critical: e.critical });
  expect(stats.lowStockInventory.count).toBe(e.lowStock);
  expect(stats.lowStockInventory.items).toHaveLength(e.lowStock);
  expect(stats.procurementAlerts.lowStockNoDeliveryCount).toBe(e.lowStock);
  expect(stats.procurementAlerts.lowStockSeverityItems).toHaveLength(e.lowStock);
  expect(stats.schedule.blockedTasks).toBe(e.blocked);
}

const ZERO: Omit<Expected, 'projects'> = {
  workers: 0, attTotal: 0, attPresent: 0, hours: 0, overtime: 0, deliveries: 0,
  contractors: 0, activeSchedules: 0, instructions: 0, critical: 0, lowStock: 0, blocked: 0,
};

const COMPANY_A: Expected = {
  projects: ['Alpha P1', 'Bravo P2'], workers: 4, attTotal: 3, attPresent: 2, hours: 24, overtime: 2,
  deliveries: 3, contractors: 3, activeSchedules: 2, instructions: 3, critical: 1, lowStock: 3, blocked: 3,
};

const P1_ONLY: Expected = {
  projects: ['Alpha P1'], workers: 2, attTotal: 2, attPresent: 1, hours: 14, overtime: 1,
  deliveries: 2, contractors: 2, activeSchedules: 1, instructions: 2, critical: 0, lowStock: 2, blocked: 2,
};

/** Every key path in an object (arrays: the keys of their first element). */
function shape(v: unknown, prefix = ''): string[] {
  if (Array.isArray(v)) return v.length ? shape(v[0], `${prefix}[]`) : [`${prefix}[]`];
  if (v && typeof v === 'object') {
    return Object.entries(v).flatMap(([k, x]) => [`${prefix}.${k}`, ...shape(x, `${prefix}.${k}`)]);
  }
  return [];
}

describe('company-wide roles are unchanged', () => {
  it.each(['admin', 'superAdmin', 'fo'])('%s sees the whole company', async (key) => {
    const { stats, raw } = await dash(key);
    expectFigures(stats, COMPANY_A);
    expect(raw).not.toContain('Zulu');
    expect(raw).not.toContain(w.pb.id);
  });
});

describe('project-scoped roles see only their projects', () => {
  it.each(['pm', 'viewer'])('%s (member of P1) sees P1 figures only', async (key) => {
    const { stats, raw } = await dash(key);
    expectFigures(stats, P1_ONLY);
    expect(raw).not.toContain('Bravo');
    expect(raw).not.toContain(w.p2.id);
    expect(raw).not.toContain('S2');
    expect(raw).not.toContain('Zulu');
  });

  it('consultant (member of P2) sees P2 figures only', async () => {
    const { stats, raw } = await dash('consultant');
    expectFigures(stats, {
      projects: ['Bravo P2'], workers: 1, attTotal: 1, attPresent: 1, hours: 10, overtime: 1,
      deliveries: 1, contractors: 1, activeSchedules: 1, instructions: 1, critical: 1, lowStock: 1, blocked: 1,
    });
    expect(raw).not.toContain('Alpha');
    expect(raw).not.toContain(w.p1.id);
    expect(raw).not.toContain('S1a');
    expect(raw).not.toContain('S1b');
  });

  it('site_supervisor sees only the assigned site', async () => {
    const { stats, raw } = await dash('sup');
    expectFigures(stats, {
      projects: ['Alpha P1'], workers: 1, attTotal: 1, attPresent: 1, hours: 9, overtime: 1,
      // Instructions follow instruction.service: project-wide unless SITE_SCOPE_STRICT
      deliveries: 1, contractors: 1, activeSchedules: 1, instructions: 2, critical: 0, lowStock: 1, blocked: 1,
    });
    expect(raw).not.toContain('Bravo');
    expect(raw).not.toContain(w.p2.id);
    expect(raw).not.toContain('S1b');
  });

  it('contractor sees member projects and only their own contractor records', async () => {
    const { stats, raw } = await dash('contractor');
    expectFigures(stats, {
      projects: ['Alpha P1'], workers: 2, attTotal: 2, attPresent: 1, hours: 14, overtime: 1,
      deliveries: 2, contractors: 1, activeSchedules: 1, instructions: 1, critical: 0, lowStock: 2, blocked: 1,
    });
    expect(raw).not.toContain('Bravo');
    expect(raw).not.toContain(w.p2.id);
  });

  it('worker sees their own project and their own attendance and labour only', async () => {
    const { stats, raw } = await dash('worker');
    expectFigures(stats, { ...ZERO, projects: ['Alpha P1'], workers: 1, attTotal: 1, attPresent: 1, hours: 9, overtime: 1 });
    expect(raw).not.toContain('Bravo');
    expect(raw).not.toContain(w.p2.id);
  });

  it('worker with no membership and no linked record sees nothing', async () => {
    const { stats } = await dash('workerNone');
    expectFigures(stats, { ...ZERO, projects: [] });
  });

  it('removed project member sees nothing', async () => {
    const { stats, raw } = await dash('pmRemoved');
    expectFigures(stats, { ...ZERO, projects: [] });
    expect(raw).not.toContain('Bravo');
  });
});

describe('tenant isolation', () => {
  it('other company admin sees only their own company', async () => {
    const { stats, raw } = await dash('adminB');
    expectFigures(stats, {
      projects: ['Zulu B'], workers: 1, attTotal: 1, attPresent: 1, hours: 11, overtime: 1,
      deliveries: 1, contractors: 1, activeSchedules: 1, instructions: 1, critical: 0, lowStock: 1, blocked: 1,
    });
    expect(raw).not.toContain('Alpha');
    expect(raw).not.toContain('Bravo');
    expect(raw).not.toContain(w.p1.id);
    expect(raw).not.toContain(w.p2.id);
  });
});

describe('response shape and financial gating are unchanged', () => {
  const others = ['superAdmin', 'fo', 'pm', 'viewer', 'consultant', 'sup', 'contractor', 'worker', 'workerNone', 'pmRemoved'];

  it.each(others)('%s gets the same keys as company_admin', async (key) => {
    const ref = shape((await dash('admin')).stats).filter((k) => !k.startsWith('.finance'));
    const { stats } = await dash(key);
    const got = shape(stats).filter((k) => !k.startsWith('.finance'));
    // Empty arrays only report the array key itself
    const strip = (keys: string[]) => keys.filter((k) => !k.includes('[]'));
    expect(strip(got).sort()).toEqual(strip(ref).sort());
    const recent = stats.projects.recent[0];
    if (recent) expect(Object.keys(recent).sort()).toEqual(['code', 'id', 'location', 'name', 'status', 'updatedAt']);
  });

  it.each(['pm', 'viewer', 'consultant', 'sup', 'contractor', 'worker'])('%s without finance access still gets null money fields', async (key) => {
    const { stats } = await dash(key);
    expect(stats.labour.thisMonthCost).toBeNull();
    expect(stats.invoices).toEqual({ total: null, totalValue: null, totalPaid: null, outstanding: null, overdueCount: null, pendingApproval: null });
    expect(stats.budget).toEqual({ totalBudgeted: null, totalSpent: null, totalRemaining: null, budgetsCount: null, overspendCount: null });
    expect(stats.finance).toBeUndefined();
  });

  it('company_admin money fields are still computed company-wide', async () => {
    const { stats } = await dash('admin');
    // 3 labour entries in company A at dailyRate 100
    expect(stats.labour.thisMonthCost).toBe(300);
    expect(stats.invoices.total).toBe(0);
  });
});
