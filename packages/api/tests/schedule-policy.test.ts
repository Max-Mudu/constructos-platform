/**
 * Owner-approved schedule policy decisions:
 *
 *  C. A contractor-role user may only attach a task to their OWN work package
 *     (createTask / updateTask). For every role the package must also be in
 *     the URL's company, project and site. Rejections are the same generic 404
 *     as a nonexistent package. Cross-contractor task dependencies stay allowed
 *     within one company/project/site.
 *  D. Every task in a weekly plan must belong to the plan's contractor, for
 *     every role (including project_manager and company_admin). Rejections are
 *     the same 404 as a nonexistent task.
 */
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
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

async function seedWorld(suffix: string) {
  const { company, admin } = await createTestCompany(app, suffix);
  const project = await createTestProject(company.id, 'Project A');
  const site    = await createTestSite(company.id, project.id);
  // Used only to build deliberately inconsistent rows (siteId of `site`, projectId of `projectB`).
  const projectB = await createTestProject(company.id, 'Project B');

  const user = await createTestUser(app, company.id, 'contractor', suffix);
  await assignUserToProject(company.id, project.id, user.id);

  const pm = await createTestUser(app, company.id, 'project_manager', `${suffix}-pm`);
  await assignUserToProject(company.id, project.id, pm.id);

  const own   = await createTestContractor(company.id, 'Own Contractor', user.id);
  const other = await createTestContractor(company.id, 'Other Contractor');

  const ownTask   = await createTestScheduleTask(company.id, project.id, site.id, own.id,   admin.id, undefined, 'Own Task');
  const ownTask2  = await createTestScheduleTask(company.id, project.id, site.id, own.id,   admin.id, undefined, 'Own Task 2');
  const otherTask = await createTestScheduleTask(company.id, project.id, site.id, other.id, admin.id, undefined, 'Other Task');

  const ownPkg   = await createTestWorkPackage(company.id, project.id, site.id, own.id,   admin.id, 'Own Package');
  const otherPkg = await createTestWorkPackage(company.id, project.id, site.id, other.id, admin.id, 'Other Package');
  const wrongProjectPkg = await createTestWorkPackage(company.id, projectB.id, site.id, own.id, admin.id, 'Wrong Project Package');

  return {
    company, admin, project, projectB, site, user, pm, own, other,
    ownTask, ownTask2, otherTask, ownPkg, otherPkg, wrongProjectPkg,
    base:      BASE(project.id, site.id),
    auth:      { authorization: `Bearer ${user.accessToken}` },
    pmAuth:    { authorization: `Bearer ${pm.accessToken}` },
    adminAuth: { authorization: `Bearer ${admin.accessToken}` },
  };
}

const taskCount = (siteId: string) => prisma.scheduleTask.count({ where: { siteId } });
const pkgOf     = async (taskId: string) =>
  (await prisma.scheduleTask.findUnique({ where: { id: taskId } }))!.workPackageId;

// ─── C. Work package attachment ──────────────────────────────────────────────

describe('C — contractor work-package attachment on createTask', () => {
  it('contractor attaching a new task to their own package — 201', async () => {
    const w = await seedWorld('pol-c-create-own');
    const res = await app.inject({
      method: 'POST', url: `${w.base}/tasks`, headers: w.auth,
      payload: { contractorId: w.own.id, workPackageId: w.ownPkg.id, title: 'Mine' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().task.workPackageId).toBe(w.ownPkg.id);
  });

  it('contractor attaching a new task to another contractor\'s package — 404 identical to a nonexistent package, nothing created', async () => {
    const w = await seedWorld('pol-c-create-foreign');
    const before = await taskCount(w.site.id);

    const res = await app.inject({
      method: 'POST', url: `${w.base}/tasks`, headers: w.auth,
      payload: { contractorId: w.own.id, workPackageId: w.otherPkg.id, title: 'Sneaky' },
    });
    const missing = await app.inject({
      method: 'POST', url: `${w.base}/tasks`, headers: w.auth,
      payload: { contractorId: w.own.id, workPackageId: MISSING_ID, title: 'Missing' },
    });

    expect(res.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(res.json()).toEqual(missing.json());
    expect(res.body).not.toContain('Other Package');
    expect(await taskCount(w.site.id)).toBe(before);
  });

  it('PM may attach a task to any contractor\'s package in the same project/site — 201', async () => {
    const w = await seedWorld('pol-c-create-pm');
    const res = await app.inject({
      method: 'POST', url: `${w.base}/tasks`, headers: w.pmAuth,
      payload: { contractorId: w.own.id, workPackageId: w.otherPkg.id, title: 'PM task' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('package whose projectId differs from the URL project is rejected for every role — 404, nothing created', async () => {
    const w = await seedWorld('pol-c-create-xproj');
    const before = await taskCount(w.site.id);

    for (const headers of [w.auth, w.pmAuth, w.adminAuth]) {
      const res = await app.inject({
        method: 'POST', url: `${w.base}/tasks`, headers,
        payload: { contractorId: w.own.id, workPackageId: w.wrongProjectPkg.id, title: 'X-proj' },
      });
      expect(res.statusCode).toBe(404);
    }
    expect(await taskCount(w.site.id)).toBe(before);
  });
});

describe('C — contractor work-package attachment on updateTask', () => {
  it('contractor moving their own task into their own package — 200', async () => {
    const w = await seedWorld('pol-c-update-own');
    const res = await app.inject({
      method: 'PATCH', url: `${w.base}/tasks/${w.ownTask.id}`, headers: w.auth,
      payload: { workPackageId: w.ownPkg.id },
    });
    expect(res.statusCode).toBe(200);
    expect(await pkgOf(w.ownTask.id)).toBe(w.ownPkg.id);
  });

  it('contractor moving their own task into another contractor\'s package — 404 identical to a nonexistent package, row unchanged', async () => {
    const w = await seedWorld('pol-c-update-foreign');

    const res = await app.inject({
      method: 'PATCH', url: `${w.base}/tasks/${w.ownTask.id}`, headers: w.auth,
      payload: { workPackageId: w.otherPkg.id },
    });
    const missing = await app.inject({
      method: 'PATCH', url: `${w.base}/tasks/${w.ownTask.id}`, headers: w.auth,
      payload: { workPackageId: MISSING_ID },
    });

    expect(res.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(res.json()).toEqual(missing.json());
    expect(await pkgOf(w.ownTask.id)).toBeNull();
  });

  it('PM may move a task into any contractor\'s package in the same project/site — 200', async () => {
    const w = await seedWorld('pol-c-update-pm');
    const res = await app.inject({
      method: 'PATCH', url: `${w.base}/tasks/${w.ownTask.id}`, headers: w.pmAuth,
      payload: { workPackageId: w.otherPkg.id },
    });
    expect(res.statusCode).toBe(200);
    expect(await pkgOf(w.ownTask.id)).toBe(w.otherPkg.id);
  });

  it('package whose projectId differs from the URL project is rejected for every role — 404, row unchanged', async () => {
    const w = await seedWorld('pol-c-update-xproj');
    for (const headers of [w.auth, w.pmAuth, w.adminAuth]) {
      const res = await app.inject({
        method: 'PATCH', url: `${w.base}/tasks/${w.ownTask.id}`, headers,
        payload: { workPackageId: w.wrongProjectPkg.id },
      });
      expect(res.statusCode).toBe(404);
    }
    expect(await pkgOf(w.ownTask.id)).toBeNull();
  });

  it('contractor may still detach their own task from a package (workPackageId: null) — 200', async () => {
    const w = await seedWorld('pol-c-update-detach');
    await prisma.scheduleTask.update({ where: { id: w.ownTask.id }, data: { workPackageId: w.ownPkg.id } });
    const res = await app.inject({
      method: 'PATCH', url: `${w.base}/tasks/${w.ownTask.id}`, headers: w.auth,
      payload: { workPackageId: null },
    });
    expect(res.statusCode).toBe(200);
    expect(await pkgOf(w.ownTask.id)).toBeNull();
  });
});

describe('C — cross-contractor dependencies remain allowed in one company/project/site', () => {
  it('contractor may make their own task depend on another contractor\'s task — 201', async () => {
    const w = await seedWorld('pol-c-dep-cross');
    const res = await app.inject({
      method: 'POST', url: `${w.base}/tasks/${w.ownTask.id}/dependencies`, headers: w.auth,
      payload: { dependsOnTaskId: w.otherTask.id },
    });
    expect(res.statusCode).toBe(201);
    expect(await prisma.scheduleDependency.count({ where: { taskId: w.ownTask.id, dependsOnTaskId: w.otherTask.id } })).toBe(1);
  });

  it('contractor may create a task depending on another contractor\'s task — 201', async () => {
    const w = await seedWorld('pol-c-dep-create-cross');
    const res = await app.inject({
      method: 'POST', url: `${w.base}/tasks`, headers: w.auth,
      payload: { contractorId: w.own.id, title: 'After other', dependsOnTaskIds: [w.otherTask.id] },
    });
    expect(res.statusCode).toBe(201);
  });

  it('a dependency target whose projectId differs from the URL project is rejected — 404, nothing created', async () => {
    const w = await seedWorld('pol-c-dep-xproj');
    const wrongProjectTask = await createTestScheduleTask(
      w.company.id, w.projectB.id, w.site.id, w.own.id, w.admin.id, undefined, 'Wrong Project Task',
    );
    const res = await app.inject({
      method: 'POST', url: `${w.base}/tasks/${w.ownTask.id}/dependencies`, headers: w.pmAuth,
      payload: { dependsOnTaskId: wrongProjectTask.id },
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.scheduleDependency.count({ where: { taskId: w.ownTask.id } })).toBe(0);
  });
});

// ─── D. Weekly plan items must belong to the plan's contractor ──────────────

describe('D — weekly plan task items must belong to the plan\'s contractor (all roles)', () => {
  const planPayload = (contractorId: string, taskIds: string[]) => ({
    contractorId, weekStartDate: '2026-04-13', items: taskIds.map((taskId) => ({ taskId })),
  });

  it('PM plan for one contractor using only that contractor\'s tasks — 201', async () => {
    const w = await seedWorld('pol-d-pm-ok');
    const res = await app.inject({
      method: 'POST', url: `${w.base}/weekly-plans`, headers: w.pmAuth,
      payload: planPayload(w.own.id, [w.ownTask.id, w.ownTask2.id]),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().plan.items).toHaveLength(2);
  });

  it('PM and company_admin plans including another contractor\'s task — 404 identical to a nonexistent task, nothing created', async () => {
    const w = await seedWorld('pol-d-foreign');
    const before = await prisma.weeklyPlan.count();

    const missing = await app.inject({
      method: 'POST', url: `${w.base}/weekly-plans`, headers: w.pmAuth,
      payload: planPayload(w.own.id, [MISSING_ID]),
    });
    expect(missing.statusCode).toBe(404);

    for (const headers of [w.pmAuth, w.adminAuth]) {
      for (const taskIds of [[w.otherTask.id], [w.ownTask.id, w.otherTask.id]]) {
        const res = await app.inject({
          method: 'POST', url: `${w.base}/weekly-plans`, headers,
          payload: planPayload(w.own.id, taskIds),
        });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual(missing.json());
        expect(res.body).not.toContain('Other Task');
      }
    }
    expect(await prisma.weeklyPlan.count()).toBe(before);
    expect(await prisma.weeklyPlanItem.count({ where: { taskId: w.otherTask.id } })).toBe(0);
  });

  it('contractor plan including another contractor\'s task — still 404, nothing created', async () => {
    const w = await seedWorld('pol-d-contractor');
    const before = await prisma.weeklyPlan.count();
    const res = await app.inject({
      method: 'POST', url: `${w.base}/weekly-plans`, headers: w.auth,
      payload: planPayload(w.own.id, [w.ownTask.id, w.otherTask.id]),
    });
    expect(res.statusCode).toBe(404);
    expect(await prisma.weeklyPlan.count()).toBe(before);
  });
});
