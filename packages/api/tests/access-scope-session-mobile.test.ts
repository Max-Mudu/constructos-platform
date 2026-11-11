/**
 * Session and scope rules for the routes used by the mobile and web clients.
 *
 * 1. Session check on every route in this group: a request is accepted only
 *    while the caller's session is current. A token of a deactivated user, and
 *    a token issued before the user's sessions were ended (password reset,
 *    account setup, deactivation), gets 401 on each route, whatever the body.
 *    (The live-updates stream has the same checks in session-version-coverage.)
 *
 * 2. Worker check-in, POST /projects/:projectId/sites/:siteId/attendance/self:
 *    only the worker role, only on a site the worker is currently assigned to,
 *    under the project that owns the assignment, and always for the caller's
 *    own worker record.
 *
 * 3. Mobile lists, GET /labour and GET /deliveries: roles outside the route
 *    lists are refused, and a worker filter cannot reach another company's rows.
 */
import { randomUUID } from 'crypto';
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
  createTestLabourEntry,
  assignUserToProject,
  assignWorkerToSite,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface World {
  companyA: string;
  admin: TestUser;
  live: TestUser;           // company admin, session current
  deactivated: TestUser;    // company admin, account deactivated
  stale: TestUser;          // company admin, sessions ended after the token was issued
  staff: Record<string, TestUser>;   // one user per non-worker role, members of P1
  workerUser: TestUser;     // worker role, linked to `worker`, assigned to P1 / S1
  formerUser: TestUser;     // worker role, linked to `former`, assignment to S1 ended
  worker: string;
  colleague: string;        // another worker assigned to S1
  former: string;
  foreignWorker: string;    // company B
  p1: string; s1: string; s2: string;   // company A, project P1 with two sites
  p2: string;                           // company A, project P2
  q: string; y: string;                 // company B, project Q with site Y
}

let w: World;

const STAFF_ROLES: UserRole[] = [
  'project_manager', 'site_supervisor', 'finance_officer', 'viewer', 'consultant', 'contractor',
];

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'scope-sm-a');
  const b = await createTestCompany(app, 'scope-sm-b');
  const cid = a.company.id;
  const bid = b.company.id;

  const p1 = await createTestProject(cid, 'P1');
  const s1 = await createTestSite(cid, p1.id, 'S1');
  const s2 = await createTestSite(cid, p1.id, 'S2');
  const p2 = await createTestProject(cid, 'P2');
  const q  = await createTestProject(bid, 'Q');
  const y  = await createTestSite(bid, q.id, 'Y');

  const live        = await createTestUser(app, cid, 'company_admin', 'scope-sm-live');
  const deactivated = await createTestUser(app, cid, 'company_admin', 'scope-sm-off');
  const stale       = await createTestUser(app, cid, 'company_admin', 'scope-sm-stale');
  await prisma.user.update({ where: { id: deactivated.id }, data: { isActive: false } });
  await prisma.user.update({ where: { id: stale.id }, data: { sessionVersion: { increment: 1 } } });

  const staff: Record<string, TestUser> = {};
  for (const role of STAFF_ROLES) {
    const u = await createTestUser(app, cid, role, `scope-sm-${role}`, { canViewFinance: role === 'finance_officer' });
    await assignUserToProject(cid, p1.id, u.id, role === 'site_supervisor' ? s1.id : undefined);
    staff[role] = u;
  }

  const worker        = await createTestWorker(cid, { firstName: 'Own' });
  const colleague     = await createTestWorker(cid, { firstName: 'Colleague' });
  const former        = await createTestWorker(cid, { firstName: 'Former' });
  const foreignWorker = await createTestWorker(bid, { firstName: 'Foreign' });
  const workerUser = await createTestUser(app, cid, 'worker', 'scope-sm-worker');
  const formerUser = await createTestUser(app, cid, 'worker', 'scope-sm-former');
  await prisma.worker.update({ where: { id: worker.id }, data: { userId: workerUser.id } });
  await prisma.worker.update({ where: { id: former.id }, data: { userId: formerUser.id } });
  await assignWorkerToSite(cid, p1.id, s1.id, worker.id, a.admin.id);
  await assignWorkerToSite(cid, p1.id, s1.id, colleague.id, a.admin.id);
  await assignWorkerToSite(cid, p1.id, s1.id, former.id, a.admin.id);
  await prisma.workerAssignment.updateMany({ where: { workerId: former.id }, data: { removedAt: new Date() } });

  // One labour entry per company, for the mobile labour list.
  await createTestLabourEntry(cid, p1.id, s1.id, colleague.id, a.admin.id);
  await createTestLabourEntry(bid, q.id, y.id, foreignWorker.id, b.admin.id);

  w = {
    companyA: cid, admin: a.admin, live, deactivated, stale, staff, workerUser, formerUser,
    worker: worker.id, colleague: colleague.id, former: former.id, foreignWorker: foreignWorker.id,
    p1: p1.id, s1: s1.id, s2: s2.id, p2: p2.id, q: q.id, y: y.id,
  };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

function call(user: TestUser, method: Method, url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${user.accessToken}` },
    ...(payload ? { payload } : {}),
  });
}

// ─── 1. Session check on every route ──────────────────────────────────────────

/** An id of the right shape that matches no row, so no request here changes data. */
const NO_ROW = randomUUID();

const site = () => `/api/v1/projects/${w.p1}/sites/${w.s1}`;

const ROUTES: Array<[string, Method, () => string]> = [
  ['inventory list',             'GET',    () => `${site()}/inventory`],
  ['inventory item',             'GET',    () => `${site()}/inventory/${NO_ROW}`],
  ['inventory threshold update', 'PATCH',  () => `${site()}/inventory/${NO_ROW}`],
  ['inventory usage',            'POST',   () => `${site()}/inventory/${NO_ROW}/use`],
  ['inventory adjustment',       'POST',   () => `${site()}/inventory/${NO_ROW}/adjust`],
  ['labour list',                'GET',    () => `${site()}/labour`],
  ['labour create',              'POST',   () => `${site()}/labour`],
  ['labour entry',               'GET',    () => `${site()}/labour/${NO_ROW}`],
  ['labour edit',                'PATCH',  () => `${site()}/labour/${NO_ROW}`],
  ['labour delete',              'DELETE', () => `${site()}/labour/${NO_ROW}`],
  ['worker check-in',            'POST',   () => `${site()}/attendance/self`],
  ['delivery photo upload',      'POST',   () => `${site()}/deliveries/${NO_ROW}/photos`],
  ['delivery photo delete',      'DELETE', () => `${site()}/deliveries/${NO_ROW}/photos/${NO_ROW}`],
  ['delivery document upload',   'POST',   () => `${site()}/deliveries/${NO_ROW}/documents`],
  ['delivery document delete',   'DELETE', () => `${site()}/deliveries/${NO_ROW}/documents/${NO_ROW}`],
  ['daily report photo upload',  'POST',   () => `${site()}/daily-reports/${NO_ROW}/photos`],
  ['daily report PDF',           'GET',    () => `${site()}/daily-reports/${NO_ROW}/pdf`],
  ['drawing revision upload',    'POST',   () => `/api/v1/projects/${w.p1}/drawings/${NO_ROW}/revisions`],
  ['dashboard',                  'GET',    () => '/api/v1/dashboard'],
  ['mobile labour list',         'GET',    () => '/api/v1/labour'],
  ['mobile delivery list',       'GET',    () => '/api/v1/deliveries'],
  ['worker list',                'GET',    () => '/api/v1/workers'],
  ['worker detail',              'GET',    () => `/api/v1/workers/${NO_ROW}`],
  ['stored file download',       'GET',    () => `/uploads/photos/${NO_ROW}.jpg`],
];

describe('session check on every route', () => {
  it.each(ROUTES)('%s: a current session is not answered with 401', async (_name, method, url) => {
    const res = await call(w.live, method, url());
    expect(res.statusCode).not.toBe(401);
  });

  it.each(ROUTES)('%s: a deactivated user gets 401', async (_name, method, url) => {
    const res = await call(w.deactivated, method, url());
    expect(res.statusCode).toBe(401);
  });

  it.each(ROUTES)('%s: a token issued before the sessions were ended gets 401', async (_name, method, url) => {
    const res = await call(w.stale, method, url());
    expect(res.statusCode).toBe(401);
  });

  it.each(ROUTES)('%s: a request without a token gets 401', async (_name, method, url) => {
    const res = await app.inject({ method, url: url() });
    expect(res.statusCode).toBe(401);
  });
});

// ─── 2. Worker check-in ───────────────────────────────────────────────────────

const selfUrl = (projectId: string, siteId: string) =>
  `/api/v1/projects/${projectId}/sites/${siteId}/attendance/self`;

describe('worker check-in is limited to the caller and their assigned site', () => {
  it('positive control: a worker checks in on the site they are assigned to', async () => {
    const res = await call(w.workerUser, 'POST', selfUrl(w.p1, w.s1), { checkInTime: '08:00' });
    expect(res.statusCode).toBe(201);

    const rows = await prisma.attendanceRecord.findMany({ where: { workerId: w.worker } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: w.companyA, projectId: w.p1, siteId: w.s1, recordedById: w.workerUser.id,
    });
  });

  it("a check-in is recorded for the caller even when the body names another worker", async () => {
    const res = await call(w.workerUser, 'POST', selfUrl(w.p1, w.s1), { workerId: w.colleague, checkInTime: '07:30' });
    expect(res.statusCode).toBe(201);
    expect(res.json().record.workerId).toBe(w.worker);
    expect(await prisma.attendanceRecord.count({ where: { workerId: w.colleague } })).toBe(0);
    expect(await prisma.attendanceRecord.count({ where: { workerId: w.worker } })).toBe(1);
  });

  it('a worker gets 403 on a site of the project they are not assigned to, and nothing is recorded', async () => {
    const res = await call(w.workerUser, 'POST', selfUrl(w.p1, w.s2), { checkInTime: '08:00' });
    expect(res.statusCode).toBe(403);
    expect(await prisma.attendanceRecord.count({ where: { siteId: w.s2 } })).toBe(0);
  });

  it('a worker gets 403 using their assigned site under another project, and nothing is recorded', async () => {
    const res = await call(w.workerUser, 'POST', selfUrl(w.p2, w.s1), { checkInTime: '08:00' });
    expect(res.statusCode).toBe(403);
    expect(await prisma.attendanceRecord.count({ where: { projectId: w.p2 } })).toBe(0);
  });

  it("a worker gets 403 on another company's site, and nothing is recorded", async () => {
    const res = await call(w.workerUser, 'POST', selfUrl(w.q, w.y), { checkInTime: '08:00' });
    expect(res.statusCode).toBe(403);
    expect(await prisma.attendanceRecord.count({ where: { siteId: w.y } })).toBe(0);
  });

  it('a worker whose assignment to the site has ended gets 403, and nothing is recorded', async () => {
    const res = await call(w.formerUser, 'POST', selfUrl(w.p1, w.s1), { checkInTime: '08:00' });
    expect(res.statusCode).toBe(403);
    expect(await prisma.attendanceRecord.count({ where: { workerId: w.former } })).toBe(0);
  });

  it.each(['company_admin', ...STAFF_ROLES])(
    '%s cannot use the worker check-in route (403)',
    async (role) => {
      const user = role === 'company_admin' ? w.admin : w.staff[role];
      const before = await prisma.attendanceRecord.count();
      const res = await call(user, 'POST', selfUrl(w.p1, w.s1), { checkInTime: '08:00' });
      expect(res.statusCode).toBe(403);
      expect(await prisma.attendanceRecord.count()).toBe(before);
    },
  );
});

// ─── 3. Mobile lists ──────────────────────────────────────────────────────────

describe('mobile labour and delivery lists', () => {
  it.each(['viewer', 'consultant', 'contractor'])('%s (a project member) gets 403 on the labour list', async (role) => {
    expect((await call(w.staff[role], 'GET', '/api/v1/labour')).statusCode).toBe(403);
  });

  it.each(['consultant', 'contractor'])('%s (a project member) gets 403 on the delivery list', async (role) => {
    expect((await call(w.staff[role], 'GET', '/api/v1/deliveries')).statusCode).toBe(403);
  });

  it("a workerId filter naming another company's worker returns no labour rows", async () => {
    const all = await call(w.admin, 'GET', '/api/v1/labour');
    expect(all.statusCode).toBe(200);
    expect(all.json().pagination.total).toBe(1);

    const res = await call(w.admin, 'GET', `/api/v1/labour?workerId=${w.foreignWorker}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toEqual([]);
    expect(res.json().pagination.total).toBe(0);
  });
});
