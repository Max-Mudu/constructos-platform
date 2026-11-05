import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestContractor,
  createTestScheduleTask,
  createTestWorkPackage,
  assignUserToProject,
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

const BASE = (pid: string, sid: string) => `/api/v1/projects/${pid}/sites/${sid}/schedule`;

/**
 * One project/site holding schedule records for two contractors: one linked to
 * the contractor-role user (own) and one belonging to a different contractor (other).
 */
async function seedWorld(suffix: string) {
  const { company, admin } = await createTestCompany(app, suffix);
  const project = await createTestProject(company.id);
  const site    = await createTestSite(company.id, project.id);

  const user = await createTestUser(app, company.id, 'contractor', suffix);
  await assignUserToProject(company.id, project.id, user.id);

  const own   = await createTestContractor(company.id, 'Own Contractor', user.id);
  const other = await createTestContractor(company.id, 'Other Contractor');

  const ownTask    = await createTestScheduleTask(company.id, project.id, site.id, own.id,   admin.id, undefined, 'Own Task');
  const ownTask2   = await createTestScheduleTask(company.id, project.id, site.id, own.id,   admin.id, undefined, 'Own Task 2');
  const otherTask  = await createTestScheduleTask(company.id, project.id, site.id, other.id, admin.id, undefined, 'Other Task');
  const otherTask2 = await createTestScheduleTask(company.id, project.id, site.id, other.id, admin.id, undefined, 'Other Task 2');

  const ownPkg   = await createTestWorkPackage(company.id, project.id, site.id, own.id,   admin.id, 'Own Package');
  const otherPkg = await createTestWorkPackage(company.id, project.id, site.id, other.id, admin.id, 'Other Package');

  const mkMilestone = (taskId: string, name: string) => prisma.scheduleMilestone.create({
    data: { companyId: company.id, projectId: project.id, siteId: site.id, taskId, name, plannedDate: new Date('2026-05-01') },
  });
  const ownMs   = await mkMilestone(ownTask.id,   'Own Milestone');
  const otherMs = await mkMilestone(otherTask.id, 'Other Milestone');

  const mkPlan = (contractorId: string, taskId: string) => prisma.weeklyPlan.create({
    data: {
      companyId: company.id, projectId: project.id, siteId: site.id, contractorId,
      weekStartDate: new Date('2026-04-06'), createdById: admin.id,
      items: { create: [{ taskId, plannedHours: 8 }] },
    },
  });
  const ownPlan   = await mkPlan(own.id,   ownTask.id);
  const otherPlan = await mkPlan(other.id, otherTask.id);

  return {
    company, admin, project, site, user, own, other,
    ownTask, ownTask2, otherTask, otherTask2, ownPkg, otherPkg, ownMs, otherMs, ownPlan, otherPlan,
    base: BASE(project.id, site.id),
    auth: { authorization: `Bearer ${user.accessToken}` },
  };
}

async function taskTitle(id: string) {
  return (await prisma.scheduleTask.findUnique({ where: { id } }))?.title ?? null;
}

describe('Contractor ownership — schedule tasks', () => {
  it('contractor can read, update and view activity of their own task — 200', async () => {
    const w = await seedWorld('consec-task-own');

    const get = await app.inject({ method: 'GET', url: `${w.base}/tasks/${w.ownTask.id}`, headers: w.auth });
    expect(get.statusCode).toBe(200);
    expect(get.json().task.id).toBe(w.ownTask.id);

    const patch = await app.inject({
      method: 'PATCH', url: `${w.base}/tasks/${w.ownTask.id}`, headers: w.auth,
      payload: { actualProgress: 40, status: 'in_progress' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().task.status).toBe('in_progress');

    const act = await app.inject({ method: 'GET', url: `${w.base}/tasks/${w.ownTask.id}/activity`, headers: w.auth });
    expect(act.statusCode).toBe(200);
    expect(act.json().activities.length).toBeGreaterThan(0);
  });

  it('contractor cannot read another contractor\'s task — 404', async () => {
    const w = await seedWorld('consec-task-get');
    const res = await app.inject({ method: 'GET', url: `${w.base}/tasks/${w.otherTask.id}`, headers: w.auth });
    expect(res.statusCode).toBe(404);
  });

  it('contractor cannot update another contractor\'s task — 404, row unchanged, no activity written', async () => {
    const w = await seedWorld('consec-task-patch');
    const res = await app.inject({
      method: 'PATCH', url: `${w.base}/tasks/${w.otherTask.id}`, headers: w.auth,
      payload: { title: 'Hijacked', status: 'blocked', delayReason: 'sabotage' },
    });
    expect(res.statusCode).toBe(404);

    const row = await prisma.scheduleTask.findUnique({ where: { id: w.otherTask.id } });
    expect(row!.title).toBe('Other Task');
    expect(row!.status).toBe('not_started');
    expect(await prisma.scheduleActivity.count({ where: { scheduleTaskId: w.otherTask.id } })).toBe(0);
  });

  it('contractor cannot read another contractor\'s task activity — 404', async () => {
    const w = await seedWorld('consec-task-activity');
    const res = await app.inject({ method: 'GET', url: `${w.base}/tasks/${w.otherTask.id}/activity`, headers: w.auth });
    expect(res.statusCode).toBe(404);
  });

  it('contractor cannot delete any task (route is manage-only) — 403, row unchanged', async () => {
    const w = await seedWorld('consec-task-delete');
    const res = await app.inject({ method: 'DELETE', url: `${w.base}/tasks/${w.otherTask.id}`, headers: w.auth });
    expect(res.statusCode).toBe(403);
    expect(await taskTitle(w.otherTask.id)).toBe('Other Task');
  });

  it('contractor user with no linked contractor record cannot read any task — 404', async () => {
    const w = await seedWorld('consec-task-unlinked');
    const stranger = await createTestUser(app, w.company.id, 'contractor', 'consec-task-unlinked-2');
    await assignUserToProject(w.company.id, w.project.id, stranger.id);

    const res = await app.inject({
      method: 'GET', url: `${w.base}/tasks/${w.ownTask.id}`,
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('non-contractor roles are not restricted by contractor ownership (PM reads any contractor\'s task) — 200', async () => {
    const w = await seedWorld('consec-task-pm');
    const pm = await createTestUser(app, w.company.id, 'project_manager', 'consec-task-pm');
    await assignUserToProject(w.company.id, w.project.id, pm.id);

    const res = await app.inject({
      method: 'GET', url: `${w.base}/tasks/${w.otherTask.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('Contractor ownership — milestones', () => {
  it('contractor can list, create and update milestones on their own task', async () => {
    const w = await seedWorld('consec-ms-own');

    const list = await app.inject({ method: 'GET', url: `${w.base}/tasks/${w.ownTask.id}/milestones`, headers: w.auth });
    expect(list.statusCode).toBe(200);
    expect(list.json().milestones.map((m: { id: string }) => m.id)).toEqual([w.ownMs.id]);

    const create = await app.inject({
      method: 'POST', url: `${w.base}/tasks/${w.ownTask.id}/milestones`, headers: w.auth,
      payload: { name: 'New Own Milestone', plannedDate: '2026-06-01' },
    });
    expect(create.statusCode).toBe(201);

    const patch = await app.inject({
      method: 'PATCH', url: `${w.base}/tasks/${w.ownTask.id}/milestones/${w.ownMs.id}`, headers: w.auth,
      payload: { status: 'completed' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().milestone.status).toBe('completed');
  });

  it('contractor cannot list milestones of another contractor\'s task — 404', async () => {
    const w = await seedWorld('consec-ms-list');
    const res = await app.inject({ method: 'GET', url: `${w.base}/tasks/${w.otherTask.id}/milestones`, headers: w.auth });
    expect(res.statusCode).toBe(404);
  });

  it('contractor cannot create a milestone on another contractor\'s task — 404, nothing created', async () => {
    const w = await seedWorld('consec-ms-create');
    const res = await app.inject({
      method: 'POST', url: `${w.base}/tasks/${w.otherTask.id}/milestones`, headers: w.auth,
      payload: { name: 'Injected', plannedDate: '2026-06-01' },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.scheduleMilestone.count({ where: { taskId: w.otherTask.id } })).toBe(1);
  });

  it('contractor cannot update a milestone on another contractor\'s task — 404, row unchanged', async () => {
    const w = await seedWorld('consec-ms-patch');
    const res = await app.inject({
      method: 'PATCH', url: `${w.base}/tasks/${w.otherTask.id}/milestones/${w.otherMs.id}`, headers: w.auth,
      payload: { name: 'Hijacked', status: 'cancelled' },
    });
    expect(res.statusCode).toBe(404);
    const row = await prisma.scheduleMilestone.findUnique({ where: { id: w.otherMs.id } });
    expect(row!.name).toBe('Other Milestone');
    expect(row!.status).toBe('pending');
  });

  it('contractor cannot delete milestones (route is manage-only) — 403, row unchanged', async () => {
    const w = await seedWorld('consec-ms-delete');
    const res = await app.inject({
      method: 'DELETE', url: `${w.base}/tasks/${w.otherTask.id}/milestones/${w.otherMs.id}`, headers: w.auth,
    });
    expect(res.statusCode).toBe(403);
    expect(await prisma.scheduleMilestone.count({ where: { id: w.otherMs.id } })).toBe(1);
  });
});

describe('Contractor ownership — dependencies', () => {
  it('contractor can add and remove a dependency between their own tasks', async () => {
    const w = await seedWorld('consec-dep-own');

    const add = await app.inject({
      method: 'POST', url: `${w.base}/tasks/${w.ownTask2.id}/dependencies`, headers: w.auth,
      payload: { dependsOnTaskId: w.ownTask.id },
    });
    expect(add.statusCode).toBe(201);

    const del = await app.inject({
      method: 'DELETE', url: `${w.base}/tasks/${w.ownTask2.id}/dependencies/${w.ownTask.id}`, headers: w.auth,
    });
    expect(del.statusCode).toBe(204);
    expect(await prisma.scheduleDependency.count({ where: { taskId: w.ownTask2.id } })).toBe(0);
  });

  it('contractor cannot add a dependency to another contractor\'s task — 404, nothing created', async () => {
    const w = await seedWorld('consec-dep-add');
    const res = await app.inject({
      method: 'POST', url: `${w.base}/tasks/${w.otherTask2.id}/dependencies`, headers: w.auth,
      payload: { dependsOnTaskId: w.otherTask.id },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.scheduleDependency.count({ where: { taskId: w.otherTask2.id } })).toBe(0);
  });

  it('contractor cannot remove a dependency from another contractor\'s task — 404, row unchanged', async () => {
    const w = await seedWorld('consec-dep-remove');
    await prisma.scheduleDependency.create({
      data: { companyId: w.company.id, taskId: w.otherTask2.id, dependsOnTaskId: w.otherTask.id },
    });

    const res = await app.inject({
      method: 'DELETE', url: `${w.base}/tasks/${w.otherTask2.id}/dependencies/${w.otherTask.id}`, headers: w.auth,
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.scheduleDependency.count({ where: { taskId: w.otherTask2.id } })).toBe(1);
  });
});

describe('Contractor ownership — work packages', () => {
  it('contractor can read and update their own work package — 200', async () => {
    const w = await seedWorld('consec-pkg-own');

    const get = await app.inject({ method: 'GET', url: `${w.base}/packages/${w.ownPkg.id}`, headers: w.auth });
    expect(get.statusCode).toBe(200);

    const patch = await app.inject({
      method: 'PATCH', url: `${w.base}/packages/${w.ownPkg.id}`, headers: w.auth,
      payload: { status: 'in_progress' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().package.status).toBe('in_progress');
  });

  it('contractor cannot read another contractor\'s work package — 404', async () => {
    const w = await seedWorld('consec-pkg-get');
    const res = await app.inject({ method: 'GET', url: `${w.base}/packages/${w.otherPkg.id}`, headers: w.auth });
    expect(res.statusCode).toBe(404);
  });

  it('contractor cannot update another contractor\'s work package — 404, row unchanged', async () => {
    const w = await seedWorld('consec-pkg-patch');
    const res = await app.inject({
      method: 'PATCH', url: `${w.base}/packages/${w.otherPkg.id}`, headers: w.auth,
      payload: { name: 'Hijacked' },
    });
    expect(res.statusCode).toBe(404);
    expect((await prisma.workPackage.findUnique({ where: { id: w.otherPkg.id } }))!.name).toBe('Other Package');
  });

  it('contractor cannot delete work packages (route is manage-only) — 403, row unchanged', async () => {
    const w = await seedWorld('consec-pkg-delete');
    const res = await app.inject({ method: 'DELETE', url: `${w.base}/packages/${w.otherPkg.id}`, headers: w.auth });
    expect(res.statusCode).toBe(403);
    expect(await prisma.workPackage.count({ where: { id: w.otherPkg.id } })).toBe(1);
  });
});

describe('Contractor ownership — weekly plans', () => {
  it('contractor can read their own weekly plan — 200', async () => {
    const w = await seedWorld('consec-wp-own');
    const res = await app.inject({ method: 'GET', url: `${w.base}/weekly-plans/${w.ownPlan.id}`, headers: w.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().plan.id).toBe(w.ownPlan.id);
  });

  it('contractor cannot read another contractor\'s weekly plan — 404', async () => {
    const w = await seedWorld('consec-wp-get');
    const res = await app.inject({ method: 'GET', url: `${w.base}/weekly-plans/${w.otherPlan.id}`, headers: w.auth });
    expect(res.statusCode).toBe(404);
  });

  it('contractor can create a weekly plan for their own contractor with their own tasks — 201', async () => {
    const w = await seedWorld('consec-wp-create-own');
    const res = await app.inject({
      method: 'POST', url: `${w.base}/weekly-plans`, headers: w.auth,
      payload: {
        contractorId: w.own.id, weekStartDate: '2026-04-13',
        items: [{ taskId: w.ownTask.id, plannedHours: 8 }, { taskId: w.ownTask2.id }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().plan.items).toHaveLength(2);
  });

  it('contractor cannot include another contractor\'s task in their weekly plan — 404, nothing created', async () => {
    const w = await seedWorld('consec-wp-create-foreign-task');
    const before = await prisma.weeklyPlan.count();

    const res = await app.inject({
      method: 'POST', url: `${w.base}/weekly-plans`, headers: w.auth,
      payload: {
        contractorId: w.own.id, weekStartDate: '2026-04-13',
        items: [{ taskId: w.ownTask.id }, { taskId: w.otherTask.id }],
      },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.weeklyPlan.count()).toBe(before);
  });

  it('contractor cannot create a weekly plan for another contractor — 403 (existing body-ownership rule)', async () => {
    const w = await seedWorld('consec-wp-create-foreign-contractor');
    const before = await prisma.weeklyPlan.count();

    const res = await app.inject({
      method: 'POST', url: `${w.base}/weekly-plans`, headers: w.auth,
      payload: { contractorId: w.other.id, weekStartDate: '2026-04-13', items: [{ taskId: w.otherTask.id }] },
    });
    expect(res.statusCode).toBe(403);
    expect(await prisma.weeklyPlan.count()).toBe(before);
  });

  // Owner decision D: every task in a weekly plan must belong to the plan's
  // contractor for every role, so a PM can no longer mix in another
  // contractor's task (previously 201).
  it('PM cannot build a plan for one contractor using another contractor\'s site task — 404, nothing created', async () => {
    const w = await seedWorld('consec-wp-pm');
    const pm = await createTestUser(app, w.company.id, 'project_manager', 'consec-wp-pm');
    await assignUserToProject(w.company.id, w.project.id, pm.id);
    const before = await prisma.weeklyPlan.count();

    const res = await app.inject({
      method: 'POST', url: `${w.base}/weekly-plans`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { contractorId: w.own.id, weekStartDate: '2026-04-13', items: [{ taskId: w.otherTask.id }] },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.weeklyPlan.count()).toBe(before);
  });
});
