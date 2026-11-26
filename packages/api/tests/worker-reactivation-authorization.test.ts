/**
 * Who may reactivate a worker.
 *
 * A worker is active when isActive is true and the employment status is
 * 'active'. Making a worker who is not active active again
 * (PATCH /workers/:id { employmentStatus: 'active' }) is reserved to the
 * company admin; a project manager gets 403 WORKER_REACTIVATION_DENIED and the
 * worker stays as it was. Every other permission is unchanged: DELETE is
 * company-admin only; PATCH (other fields, suspending, deactivating) is
 * company admin and in-scope project manager; every other role is refused by
 * the role check. The status is checked with the worker row locked, so a
 * change prepared while the worker was active cannot reactivate a worker
 * deactivated in the meantime.
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
  otherSiteId: string;
  admin: TestUser;
  pm: TestUser;
  pmFinance: TestUser;
  others: Record<string, TestUser>;
}

let w: World;

const OTHER_ROLES: UserRole[] = ['site_supervisor', 'finance_officer', 'super_admin', 'contractor', 'consultant', 'viewer', 'worker'];

beforeEach(async () => {
  await clearDatabase();
  const { company, admin } = await createTestCompany(app, 'react-auth');
  const project = await createTestProject(company.id);
  const site    = await createTestSite(company.id, project.id);
  const site2   = await createTestSite(company.id, project.id, 'Second Site');
  const pm        = await createTestUser(app, company.id, 'project_manager', 'react-pm');
  const pmFinance = await createTestUser(app, company.id, 'project_manager', 'react-pmf', { canViewFinance: true });
  await assignUserToProject(company.id, project.id, pm.id);
  await assignUserToProject(company.id, project.id, pmFinance.id);
  const others: Record<string, TestUser> = {};
  for (const role of OTHER_ROLES) {
    const u = await createTestUser(app, company.id, role, `react-${role}`);
    await assignUserToProject(company.id, project.id, u.id, role === 'site_supervisor' ? site.id : undefined);
    others[role] = u;
  }
  w = { companyId: company.id, projectId: project.id, siteId: site.id, otherSiteId: site2.id, admin, pm, pmFinance, others };
});

function req(user: TestUser, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    ...(payload && { payload }),
  });
}

/** An active worker assigned to the project's site (so within the PMs' scope). */
async function workerInScope(firstName = 'Scoped'): Promise<string> {
  const worker = await createTestWorker(w.companyId, { firstName });
  await assignWorkerToSite(w.companyId, w.projectId, w.siteId, worker.id, w.admin.id);
  return worker.id;
}

async function status(workerId: string) {
  return prisma.worker.findUniqueOrThrow({ where: { id: workerId }, select: { isActive: true, employmentStatus: true } });
}

async function deactivatedByAdmin(): Promise<string> {
  const id = await workerInScope('Deactivated');
  expect((await req(w.admin, 'DELETE', `/workers/${id}`)).statusCode).toBe(204);
  return id;
}

const INACTIVE = { isActive: false, employmentStatus: 'inactive' };
const ACTIVE   = { isActive: true,  employmentStatus: 'active' };

// ─── Reactivation ─────────────────────────────────────────────────────────────

describe('PATCH employmentStatus active on a worker the company admin deactivated', () => {
  it('company_admin: 200, the worker is active again', async () => {
    const id = await deactivatedByAdmin();
    const res = await req(w.admin, 'PATCH', `/workers/${id}`, { employmentStatus: 'active' });
    expect(res.statusCode).toBe(200);
    expect(await status(id)).toEqual(ACTIVE);
    expect(await prisma.auditLog.count({ where: { action: 'update', entityType: 'worker', entityId: id } })).toBe(1);
  });

  it.each(['pm', 'pmFinance'] as const)('%s (worker still in scope): 403 WORKER_REACTIVATION_DENIED, nothing changes', async (who) => {
    const id = await deactivatedByAdmin();
    const res = await req(w[who], 'PATCH', `/workers/${id}`, { employmentStatus: 'active', trade: 'Changed' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('WORKER_REACTIVATION_DENIED');
    const after = await prisma.worker.findUniqueOrThrow({ where: { id } });
    expect({ isActive: after.isActive, employmentStatus: after.employmentStatus }).toEqual(INACTIVE);
    expect(after.trade).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'update', entityType: 'worker', entityId: id } })).toBe(0);
  });

  it.each(OTHER_ROLES)('%s: 403 (role check, unchanged), the worker stays inactive', async (role) => {
    const id = await deactivatedByAdmin();
    const res = await req(w.others[role]!, 'PATCH', `/workers/${id}`, { employmentStatus: 'active' });
    expect(res.statusCode).toBe(403);
    expect(await status(id)).toEqual(INACTIVE);
  });

  it('a project manager who re-assigns the worker to a site still cannot reactivate it', async () => {
    const id = await deactivatedByAdmin();
    const assign = await req(w.pm, 'POST', `/projects/${w.projectId}/sites/${w.otherSiteId}/workers`, { workerId: id });
    expect(assign.statusCode).toBe(201);
    expect(await status(id)).toEqual(INACTIVE);
    expect((await req(w.pm, 'PATCH', `/workers/${id}`, { employmentStatus: 'active' })).statusCode).toBe(403);
    expect(await status(id)).toEqual(INACTIVE);
  });
});

describe('other non-active workers', () => {
  it('a suspended worker (even one the project manager suspended) is reactivated only by the company admin', async () => {
    const id = await workerInScope('Suspended');
    expect((await req(w.pm, 'PATCH', `/workers/${id}`, { employmentStatus: 'suspended' })).statusCode).toBe(200);
    const pm = await req(w.pm, 'PATCH', `/workers/${id}`, { employmentStatus: 'active' });
    expect(pm.statusCode).toBe(403);
    expect(pm.json().code).toBe('WORKER_REACTIVATION_DENIED');
    expect(await status(id)).toEqual({ isActive: false, employmentStatus: 'suspended' });
    expect((await req(w.admin, 'PATCH', `/workers/${id}`, { employmentStatus: 'active' })).statusCode).toBe(200);
    expect(await status(id)).toEqual(ACTIVE);
  });

  it('a worker registered as inactive is activated only by the company admin', async () => {
    const created = await req(w.admin, 'POST', '/workers', { firstName: 'Registered', lastName: 'Inactive', employmentStatus: 'inactive' });
    const id = created.json().worker.id as string;
    await assignWorkerToSite(w.companyId, w.projectId, w.siteId, id, w.admin.id);
    expect((await req(w.pm, 'PATCH', `/workers/${id}`, { employmentStatus: 'active' })).statusCode).toBe(403);
    expect((await req(w.admin, 'PATCH', `/workers/${id}`, { employmentStatus: 'active' })).statusCode).toBe(200);
    expect(await status(id)).toEqual(ACTIVE);
  });
});

// ─── Unchanged permissions ────────────────────────────────────────────────────

describe('permissions that do not change', () => {
  it('a project manager can still suspend or deactivate an in-scope worker through PATCH', async () => {
    const a = await workerInScope('A');
    const b = await workerInScope('B');
    expect((await req(w.pm, 'PATCH', `/workers/${a}`, { employmentStatus: 'suspended' })).statusCode).toBe(200);
    expect((await req(w.pm, 'PATCH', `/workers/${b}`, { employmentStatus: 'inactive' })).statusCode).toBe(200);
    expect(await status(a)).toEqual({ isActive: false, employmentStatus: 'suspended' });
    expect(await status(b)).toEqual(INACTIVE);
  });

  it('a project manager can still edit other details of an inactive worker (status sent unchanged)', async () => {
    const id = await deactivatedByAdmin();
    const res = await req(w.pm, 'PATCH', `/workers/${id}`, { employmentStatus: 'inactive', phone: '+254700000001' });
    expect(res.statusCode).toBe(200);
    expect(res.json().worker.phone).toBe('+254700000001');
    expect(await status(id)).toEqual(INACTIVE);
  });

  it('a project manager sending active for an active worker is unaffected (200)', async () => {
    const id = await workerInScope();
    expect((await req(w.pm, 'PATCH', `/workers/${id}`, { employmentStatus: 'active', trade: 'Mason' })).statusCode).toBe(200);
    expect(await status(id)).toEqual(ACTIVE);
  });

  it('a project manager still gets 404 for a worker outside their scope', async () => {
    const loose = await createTestWorker(w.companyId, { firstName: 'Loose' });
    await prisma.worker.update({ where: { id: loose.id }, data: { isActive: false, employmentStatus: 'inactive' } });
    expect((await req(w.pm, 'PATCH', `/workers/${loose.id}`, { employmentStatus: 'active' })).statusCode).toBe(404);
  });

  it('DELETE stays company-admin only', async () => {
    const id = await workerInScope();
    for (const u of [w.pm, w.pmFinance, ...Object.values(w.others)]) {
      expect((await req(u, 'DELETE', `/workers/${id}`)).statusCode).toBe(403);
    }
    expect(await status(id)).toEqual(ACTIVE);
    expect((await req(w.admin, 'DELETE', `/workers/${id}`)).statusCode).toBe(204);
    expect(await status(id)).toEqual(INACTIVE);
  });

  it('company admin can still deactivate through PATCH too', async () => {
    const id = await workerInScope();
    expect((await req(w.admin, 'PATCH', `/workers/${id}`, { employmentStatus: 'inactive' })).statusCode).toBe(200);
    expect(await status(id)).toEqual(INACTIVE);
  });
});

// ─── Concurrency ──────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function rowLockWaiting(): Promise<boolean> {
  const [row] = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pg_locks l
    JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE a.datname = current_database() AND l.locktype = 'transactionid' AND NOT l.granted`;
  return (row?.n ?? 0) > 0;
}

describe('a change prepared while the worker was active, racing a deactivation', () => {
  it("a project manager's save that reaches the worker during a deactivation does not reactivate it", async () => {
    const id = await workerInScope();

    let commit!: () => void;
    const committed = new Promise<void>((r) => { commit = r; });
    let updated!: () => void;
    const isUpdated = new Promise<void>((r) => { updated = r; });
    // Same change as DELETE /workers/:id, held open before its commit.
    const deactivation = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "workers" SET "isActive" = false, "employmentStatus" = 'inactive', "updatedAt" = now()
        WHERE "id" = ${id}`;
      updated();
      await committed;
    }, { timeout: 30000, maxWait: 10000 });
    await Promise.race([isUpdated, deactivation]);

    // An edit form loaded while the worker was active sends its status back.
    const save = req(w.pm, 'PATCH', `/workers/${id}`, { employmentStatus: 'active', trade: 'Mason' });
    try {
      const end = Date.now() + 8000;
      while (!(await rowLockWaiting())) {
        if (Date.now() > end) throw new Error('the save never waited for the deactivation');
        await sleep(10);
      }
      commit();
      await deactivation;
      const res = await save;
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('WORKER_REACTIVATION_DENIED');
      expect(await status(id)).toEqual(INACTIVE);
    } finally {
      commit();
      await deactivation.catch(() => undefined);
      await save.catch(() => undefined);
    }
  });

  const RUNS = 30;
  it(`over ${RUNS} runs of a project manager's save and DELETE started together, the worker always ends inactive`, async () => {
    const problems: string[] = [];
    for (let i = 0; i < RUNS; i += 1) {
      const id = await workerInScope(`Race${i}`);
      const [save, del] = await Promise.all([
        (async () => { await sleep(i % 3); return req(w.pm, 'PATCH', `/workers/${id}`, { employmentStatus: 'active', trade: `T${i}` }); })(),
        (async () => { await sleep((i + 1) % 3); return req(w.admin, 'DELETE', `/workers/${id}`); })(),
      ]);
      if (del.statusCode !== 204) problems.push(`run ${i}: DELETE ${del.statusCode}`);
      if (![200, 403].includes(save.statusCode)) problems.push(`run ${i}: PATCH ${save.statusCode} ${save.body}`);
      const s = await status(id);
      if (s.isActive || s.employmentStatus !== 'inactive') problems.push(`run ${i}: worker ended ${JSON.stringify(s)}`);
    }
    expect(problems).toEqual([]);
  });
});
