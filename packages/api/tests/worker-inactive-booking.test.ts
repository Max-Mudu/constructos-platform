/**
 * Recording work for an inactive worker.
 *
 * New attendance records, labour entries and a worker's own check-in are
 * recorded only for an ACTIVE worker (isActive and employment status
 * 'active'). A deactivated, inactive or suspended worker is refused with
 * 422 WORKER_INACTIVE and nothing is written. Records that already exist are
 * not touched by a deactivation: they stay readable and editable as before,
 * and their audit history is kept. Concurrency: worker-inactive-race.test.ts.
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
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

interface World {
  companyId: string;
  projectId: string;
  siteId: string;
  admin: TestUser;
  pm: TestUser;
  sup: TestUser;
  active: string;      // active worker, assigned to the site
  inactive: string;    // assigned, then deactivated by the company admin (DELETE /workers/:id)
  suspended: string;   // assigned, then suspended (PATCH employmentStatus)
  otherCompanyWorker: string;
  otherAdmin: TestUser;
}

let w: World;

function req(user: TestUser, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    ...(payload && { payload }),
  });
}

const site = () => `/projects/${w.projectId}/sites/${w.siteId}`;

async function deactivate(workerId: string): Promise<void> {
  const res = await req(w.admin, 'DELETE', `/workers/${workerId}`);
  expect(res.statusCode).toBe(204);
}

async function newAssignedWorker(firstName: string): Promise<string> {
  const worker = await createTestWorker(w.companyId, { firstName, dailyWage: 1500 });
  await assignWorkerToSite(w.companyId, w.projectId, w.siteId, worker.id, w.admin.id);
  return worker.id;
}

beforeEach(async () => {
  await clearDatabase();
  const { company, admin } = await createTestCompany(app, 'inact-book');
  const project = await createTestProject(company.id);
  const s       = await createTestSite(company.id, project.id);
  const pm      = await createTestUser(app, company.id, 'project_manager', 'inact-book-pm');
  const sup     = await createTestUser(app, company.id, 'site_supervisor', 'inact-book-sup');
  await assignUserToProject(company.id, project.id, pm.id);
  await assignUserToProject(company.id, project.id, sup.id, s.id);

  const other = await createTestCompany(app, 'inact-book-other');
  const otherWorker = await createTestWorker(other.company.id, { firstName: 'Elsewhere' });

  w = {
    companyId: company.id, projectId: project.id, siteId: s.id, admin, pm, sup,
    active: '', inactive: '', suspended: '',
    otherCompanyWorker: otherWorker.id, otherAdmin: other.admin,
  };
  w.active    = await newAssignedWorker('Active');
  w.inactive  = await newAssignedWorker('Inactive');
  w.suspended = await newAssignedWorker('Suspended');

  await deactivate(w.inactive);
  const suspend = await req(admin, 'PATCH', `/workers/${w.suspended}`, { employmentStatus: 'suspended' });
  expect(suspend.statusCode).toBe(200);
});

const WRITERS = ['admin', 'pm', 'sup'] as const;

const attendanceBody = (workerId: string, date = '2026-11-20') =>
  ({ workerId, date, status: 'present', checkInTime: '07:30' });
const labourBody = (workerId: string, date = '2026-11-20') =>
  ({ workerId, date, hoursWorked: 8 });

function expectInactiveRefusal(res: { statusCode: number; json: () => { code?: string; error?: string } }) {
  expect(res.statusCode).toBe(422);
  expect(res.json().code).toBe('WORKER_INACTIVE');
  expect(res.json().error).toMatch(/inactive/i);
}

// ─── Attendance ───────────────────────────────────────────────────────────────

describe('POST attendance: only an active worker', () => {
  it.each(WRITERS)('%s can record attendance for an active worker (201, audit row written)', async (who) => {
    const res = await req(w[who], 'POST', `${site()}/attendance`, attendanceBody(w.active));
    expect(res.statusCode).toBe(201);
    const id = res.json().record.id as string;
    const audit = await prisma.auditLog.findFirst({ where: { action: 'create', entityType: 'attendance_record', entityId: id } });
    expect(audit).toBeTruthy();
  });

  it.each(WRITERS)('%s cannot record attendance for a deactivated worker (422 WORKER_INACTIVE)', async (who) => {
    const res = await req(w[who], 'POST', `${site()}/attendance`, attendanceBody(w.inactive));
    expectInactiveRefusal(res);
    expect(await prisma.attendanceRecord.count({ where: { workerId: w.inactive } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'create', entityType: 'attendance_record' } })).toBe(0);
  });

  it('a suspended worker is refused too', async () => {
    expectInactiveRefusal(await req(w.sup, 'POST', `${site()}/attendance`, attendanceBody(w.suspended)));
    expect(await prisma.attendanceRecord.count({ where: { workerId: w.suspended } })).toBe(0);
  });

  it('a worker registered with a non-active employment status is refused', async () => {
    const created = await req(w.admin, 'POST', '/workers', { firstName: 'Registered', lastName: 'Inactive', employmentStatus: 'inactive' });
    expect(created.statusCode).toBe(201);
    const id = created.json().worker.id as string;
    await assignWorkerToSite(w.companyId, w.projectId, w.siteId, id, w.admin.id);
    expectInactiveRefusal(await req(w.sup, 'POST', `${site()}/attendance`, attendanceBody(id)));
  });

  it("another company's worker is still 404, active or not", async () => {
    expect((await req(w.admin, 'POST', `${site()}/attendance`, attendanceBody(w.otherCompanyWorker))).statusCode).toBe(404);
    await req(w.otherAdmin, 'DELETE', `/workers/${w.otherCompanyWorker}`);
    expect((await req(w.admin, 'POST', `${site()}/attendance`, attendanceBody(w.otherCompanyWorker))).statusCode).toBe(404);
  });

  it('an active worker not assigned to the site is still 403', async () => {
    const loose = await createTestWorker(w.companyId, { firstName: 'Loose' });
    expect((await req(w.admin, 'POST', `${site()}/attendance`, attendanceBody(loose.id))).statusCode).toBe(403);
  });

  it('a worker reactivated by the company admin can be recorded again', async () => {
    const back = await req(w.admin, 'PATCH', `/workers/${w.inactive}`, { employmentStatus: 'active' });
    expect(back.statusCode).toBe(200);
    expect((await req(w.sup, 'POST', `${site()}/attendance`, attendanceBody(w.inactive))).statusCode).toBe(201);
  });
});

// ─── Labour ───────────────────────────────────────────────────────────────────

describe('POST labour: only an active worker', () => {
  it.each(WRITERS)('%s can record labour for an active worker (201, wage from the worker, audit row)', async (who) => {
    const res = await req(w[who], 'POST', `${site()}/labour`, labourBody(w.active));
    expect(res.statusCode).toBe(201);
    const id = res.json().entry.id as string;
    const stored = await prisma.labourEntry.findUniqueOrThrow({ where: { id } });
    expect(stored.dailyRate.toString()).toBe('1500');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'create', entityType: 'labour_entry', entityId: id } });
    expect(audit).toBeTruthy();
  });

  it.each(WRITERS)('%s cannot record labour for a deactivated worker (422 WORKER_INACTIVE)', async (who) => {
    const res = await req(w[who], 'POST', `${site()}/labour`, labourBody(w.inactive));
    expectInactiveRefusal(res);
    expect(await prisma.labourEntry.count({ where: { workerId: w.inactive } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'create', entityType: 'labour_entry' } })).toBe(0);
  });

  it('an explicit rate from a finance-authorised caller does not get round it', async () => {
    const res = await req(w.admin, 'POST', `${site()}/labour`, { ...labourBody(w.inactive), dailyRate: 2000, currency: 'KES' });
    expectInactiveRefusal(res);
  });

  it('a suspended worker is refused too', async () => {
    expectInactiveRefusal(await req(w.pm, 'POST', `${site()}/labour`, labourBody(w.suspended)));
    expect(await prisma.labourEntry.count({ where: { workerId: w.suspended } })).toBe(0);
  });

  it("another company's worker is still 404", async () => {
    expect((await req(w.admin, 'POST', `${site()}/labour`, labourBody(w.otherCompanyWorker))).statusCode).toBe(404);
  });

  it('an active worker not assigned to the site is still 403', async () => {
    const loose = await createTestWorker(w.companyId, { firstName: 'Loose' });
    expect((await req(w.admin, 'POST', `${site()}/labour`, labourBody(loose.id))).statusCode).toBe(403);
  });
});

// ─── A worker not on the site: 403 whatever its status ────────────────────────

describe('a worker not assigned to the site gets 403, active or not', () => {
  /** A worker of the company assigned only to another site, then made not active. */
  async function elsewhere(how: 'deactivated' | 'suspended'): Promise<string> {
    const otherSite = await createTestSite(w.companyId, w.projectId, `Other ${how}`);
    const worker = await createTestWorker(w.companyId, { firstName: `Elsewhere ${how}` });
    await assignWorkerToSite(w.companyId, w.projectId, otherSite.id, worker.id, w.admin.id);
    if (how === 'deactivated') await deactivate(worker.id);
    else expect((await req(w.admin, 'PATCH', `/workers/${worker.id}`, { employmentStatus: 'suspended' })).statusCode).toBe(200);
    return worker.id;
  }

  it.each([
    ['attendance', 'deactivated'], ['attendance', 'suspended'],
    ['labour', 'deactivated'], ['labour', 'suspended'],
  ] as const)('%s for a %s worker on another site: 403, not 422', async (kind, how) => {
    const id = await elsewhere(how);
    const body = kind === 'attendance' ? attendanceBody(id) : labourBody(id);
    for (const who of WRITERS) {
      const res = await req(w[who], 'POST', `${site()}/${kind}`, body);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).not.toBe('WORKER_INACTIVE');
    }
  });

  it('an inactive worker with no assignment at all: 403, not 422', async () => {
    const loose = await createTestWorker(w.companyId, { firstName: 'Unplaced', isActive: false });
    await prisma.worker.update({ where: { id: loose.id }, data: { employmentStatus: 'inactive' } });
    expect((await req(w.sup, 'POST', `${site()}/attendance`, attendanceBody(loose.id))).statusCode).toBe(403);
    expect((await req(w.sup, 'POST', `${site()}/labour`, labourBody(loose.id))).statusCode).toBe(403);
  });
});

// ─── Worker self check-in ─────────────────────────────────────────────────────

describe('POST attendance/self: only an active worker', () => {
  async function linkedUser(workerId: string, suffix: string): Promise<TestUser> {
    const user = await createTestUser(app, w.companyId, 'worker', suffix);
    await prisma.worker.update({ where: { id: workerId }, data: { userId: user.id } });
    return user;
  }

  it('an active worker can check in (201)', async () => {
    const me = await linkedUser(w.active, 'inact-self-ok');
    const res = await req(me, 'POST', `${site()}/attendance/self`, { checkInTime: '07:00' });
    expect(res.statusCode).toBe(201);
    expect(await prisma.attendanceRecord.count({ where: { workerId: w.active } })).toBe(1);
  });

  it('a deactivated worker cannot check in (422 WORKER_INACTIVE, nothing written)', async () => {
    const me = await linkedUser(w.inactive, 'inact-self-off');
    const res = await req(me, 'POST', `${site()}/attendance/self`, { checkInTime: '07:00' });
    expectInactiveRefusal(res);
    expect(await prisma.attendanceRecord.count({ where: { workerId: w.inactive } })).toBe(0);
  });

  it("after deactivation the worker cannot change today's own record either", async () => {
    const workerId = await newAssignedWorker('Today');
    const me = await linkedUser(workerId, 'inact-self-today');
    expect((await req(me, 'POST', `${site()}/attendance/self`, { checkInTime: '07:00' })).statusCode).toBe(201);
    const before = await prisma.attendanceRecord.findFirstOrThrow({ where: { workerId } });

    await deactivate(workerId);
    expectInactiveRefusal(await req(me, 'POST', `${site()}/attendance/self`, { checkInTime: '09:00', notes: 'late' }));

    const after = await prisma.attendanceRecord.findFirstOrThrow({ where: { workerId } });
    expect(after).toEqual(before);
  });
});

// ─── Existing records of a deactivated worker ─────────────────────────────────

describe('records made before a deactivation', () => {
  async function bookThenDeactivate() {
    const workerId = await newAssignedWorker('Historic');
    const att = await req(w.sup, 'POST', `${site()}/attendance`, attendanceBody(workerId, '2026-11-18'));
    const lab = await req(w.sup, 'POST', `${site()}/labour`, labourBody(workerId, '2026-11-18'));
    expect(att.statusCode).toBe(201);
    expect(lab.statusCode).toBe(201);
    const recordId = att.json().record.id as string;
    const entryId  = lab.json().entry.id as string;

    const recordBefore = await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: recordId } });
    const entryBefore  = await prisma.labourEntry.findUniqueOrThrow({ where: { id: entryId } });
    const auditBefore  = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });

    await deactivate(workerId);
    return { workerId, recordId, entryId, recordBefore, entryBefore, auditBefore };
  }

  it('deactivation changes no attendance, labour or audit row (only adds its own audit row)', async () => {
    const h = await bookThenDeactivate();
    expect(await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: h.recordId } })).toEqual(h.recordBefore);
    expect(await prisma.labourEntry.findUniqueOrThrow({ where: { id: h.entryId } })).toEqual(h.entryBefore);

    const auditAfter = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    const beforeIds = new Set(h.auditBefore.map((a) => a.id));
    expect(auditAfter.filter((a) => beforeIds.has(a.id))).toEqual(h.auditBefore);
    const added = auditAfter.filter((a) => !beforeIds.has(a.id));
    expect(added.map((a) => [a.action, a.entityType, a.entityId])).toEqual([['delete', 'worker', h.workerId]]);
  });

  it('they stay readable by every role that could read them before', async () => {
    const h = await bookThenDeactivate();
    for (const who of ['admin', 'pm', 'sup'] as const) {
      const list = await req(w[who], 'GET', `${site()}/attendance`);
      expect(list.statusCode).toBe(200);
      expect((list.json().records as Array<{ id: string }>).map((r) => r.id)).toContain(h.recordId);
      expect((await req(w[who], 'GET', `${site()}/attendance/${h.recordId}`)).statusCode).toBe(200);

      const labour = await req(w[who], 'GET', `${site()}/labour`);
      expect(labour.statusCode).toBe(200);
      expect((labour.json().entries as Array<{ id: string }>).map((e) => e.id)).toContain(h.entryId);
      expect((await req(w[who], 'GET', `${site()}/labour/${h.entryId}`)).statusCode).toBe(200);
    }
  });

  it('an attendance record can still be corrected (200, audit row written)', async () => {
    const h = await bookThenDeactivate();
    const res = await req(w.sup, 'PATCH', `${site()}/attendance/${h.recordId}`, { status: 'late', checkOutTime: '16:00' });
    expect(res.statusCode).toBe(200);
    expect(res.json().record).toMatchObject({ status: 'late', checkOutTime: '16:00', workerId: h.workerId });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'update', entityType: 'attendance_record', entityId: h.recordId } });
    expect(audit).toBeTruthy();
  });

  it('a labour entry can still be corrected, including its rate by a finance user (200, audit row written)', async () => {
    const h = await bookThenDeactivate();
    const sup = await req(w.sup, 'PATCH', `${site()}/labour/${h.entryId}`, { hoursWorked: 6, notes: 'left early' });
    expect(sup.statusCode).toBe(200);
    expect(sup.json().entry).toMatchObject({ hoursWorked: '6', notes: 'left early', workerId: h.workerId });

    const admin = await req(w.admin, 'PATCH', `${site()}/labour/${h.entryId}`, { dailyRate: 1700 });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().entry.dailyRate).toBe('1700');

    expect(await prisma.auditLog.count({ where: { action: 'update', entityType: 'labour_entry', entityId: h.entryId } })).toBe(2);
  });

  it('they can still be deleted by the roles allowed to before (204, audit row written)', async () => {
    const h = await bookThenDeactivate();
    expect((await req(w.pm, 'DELETE', `${site()}/attendance/${h.recordId}`)).statusCode).toBe(204);
    expect((await req(w.admin, 'DELETE', `${site()}/labour/${h.entryId}`)).statusCode).toBe(204);
    expect(await prisma.auditLog.count({ where: { action: 'delete', entityType: { in: ['attendance_record', 'labour_entry'] } } })).toBe(2);
  });

  it('an update cannot move an entry onto another worker (workerId in the body is ignored)', async () => {
    const att = await req(w.sup, 'POST', `${site()}/attendance`, attendanceBody(w.active));
    const lab = await req(w.sup, 'POST', `${site()}/labour`, labourBody(w.active));
    const recordId = att.json().record.id as string;
    const entryId  = lab.json().entry.id as string;

    const a = await req(w.admin, 'PATCH', `${site()}/attendance/${recordId}`, { workerId: w.inactive, notes: 'moved?' });
    const l = await req(w.admin, 'PATCH', `${site()}/labour/${entryId}`, { workerId: w.inactive, notes: 'moved?' });
    expect(a.statusCode).toBe(200);
    expect(l.statusCode).toBe(200);
    expect((await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: recordId } })).workerId).toBe(w.active);
    expect((await prisma.labourEntry.findUniqueOrThrow({ where: { id: entryId } })).workerId).toBe(w.active);
  });
});

// ─── The site worker list keeps inactive workers, flagged ─────────────────────

describe('GET site workers', () => {
  it('still lists a deactivated worker, with isActive false, for the site page (pickers filter it out)', async () => {
    const res = await req(w.sup, 'GET', `${site()}/workers`);
    expect(res.statusCode).toBe(200);
    const byId = new Map((res.json().workers as Array<{ id: string; isActive: boolean; employmentStatus: string }>).map((x) => [x.id, x]));
    expect(byId.get(w.active)).toMatchObject({ isActive: true, employmentStatus: 'active' });
    expect(byId.get(w.inactive)).toMatchObject({ isActive: false, employmentStatus: 'inactive' });
    expect(byId.get(w.suspended)).toMatchObject({ isActive: false, employmentStatus: 'suspended' });
  });
});
