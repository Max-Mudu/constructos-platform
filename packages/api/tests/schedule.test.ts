import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestContractor,
  createTestWorkPackage,
  createTestScheduleTask,
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

const PKGS  = (pid: string, sid: string) => `/api/v1/projects/${pid}/sites/${sid}/schedule/packages`;
const TASKS = (pid: string, sid: string) => `/api/v1/projects/${pid}/sites/${sid}/schedule/tasks`;
const SUMM  = (pid: string, sid: string) => `/api/v1/projects/${pid}/sites/${sid}/schedule/summary`;
const WPLANS = (pid: string, sid: string) => `/api/v1/projects/${pid}/sites/${sid}/schedule/weekly-plans`;

// ─── Work Packages — create ───────────────────────────────────────────────────

describe('POST /schedule/packages', () => {
  it('company_admin can create a work package', async () => {
    const { company, admin } = await createTestCompany(app, 'schpkg-c1');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);

    const res = await app.inject({
      method: 'POST',
      url: PKGS(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        contractorId: contractor.id,
        name:         'Foundation Works',
        description:  'All substructure works',
        area:         'Zone A',
        startDate:    '2026-04-01',
        endDate:      '2026-06-30',
      },
    });

    expect(res.statusCode).toBe(201);
    const pkg = res.json().package;
    expect(pkg.name).toBe('Foundation Works');
    expect(pkg.area).toBe('Zone A');
    expect(pkg.status).toBe('not_started');
    expect(pkg.contractor.id).toBe(contractor.id);
  });

  it('project_manager can create a work package', async () => {
    const { company } = await createTestCompany(app, 'schpkg-c2');
    const pm          = await createTestUser(app, company.id, 'project_manager', 'pm-pc2');
    const project     = await createTestProject(company.id);
    const site        = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, pm.id);
    const contractor  = await createTestContractor(company.id);

    const res = await app.inject({
      method: 'POST',
      url: PKGS(project.id, site.id),
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { contractorId: contractor.id, name: 'PM Work Package' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().package.name).toBe('PM Work Package');
  });

  it('site_supervisor cannot create work package — 403', async () => {
    const { company } = await createTestCompany(app, 'schpkg-c3');
    const sup         = await createTestUser(app, company.id, 'site_supervisor', 'sup-pc3');
    const project     = await createTestProject(company.id);
    const site        = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const contractor  = await createTestContractor(company.id);

    const res = await app.inject({
      method: 'POST',
      url: PKGS(project.id, site.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { contractorId: contractor.id, name: 'Sup Work Package' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('inactive contractor is rejected — 404', async () => {
    const { company, admin } = await createTestCompany(app, 'schpkg-c4');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    await prisma.contractor.update({ where: { id: contractor.id }, data: { isActive: false } });

    const res = await app.inject({
      method: 'POST',
      url: PKGS(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { contractorId: contractor.id, name: 'Inactive Contractor Package' },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── Work Packages — list ─────────────────────────────────────────────────────

describe('GET /schedule/packages', () => {
  it('lists work packages for a site', async () => {
    const { company, admin } = await createTestCompany(app, 'schpkg-l1');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    await createTestWorkPackage(company.id, project.id, site.id, contractor.id, admin.id, 'Package 1');
    await createTestWorkPackage(company.id, project.id, site.id, contractor.id, admin.id, 'Package 2');

    const res = await app.inject({
      method: 'GET',
      url: PKGS(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().packages).toHaveLength(2);
  });

  it('consultant can view work packages', async () => {
    const { company } = await createTestCompany(app, 'schpkg-l2');
    const consultant  = await createTestUser(app, company.id, 'consultant', 'con-pl2');
    const project     = await createTestProject(company.id);
    const site        = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, consultant.id);
    const contractor  = await createTestContractor(company.id);
    await createTestWorkPackage(company.id, project.id, site.id, contractor.id, consultant.id);

    const res = await app.inject({
      method: 'GET',
      url: PKGS(project.id, site.id),
      headers: { authorization: `Bearer ${consultant.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().packages).toHaveLength(1);
  });

  it('does not leak packages from another company', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'schpkg-l3a');
    const { company: c2, admin: a2 } = await createTestCompany(app, 'schpkg-l3b');
    const project1 = await createTestProject(c1.id);
    const site1    = await createTestSite(c1.id, project1.id);
    const project2 = await createTestProject(c2.id);
    const site2    = await createTestSite(c2.id, project2.id);
    const con1     = await createTestContractor(c1.id, 'C1 Contractor');
    const con2     = await createTestContractor(c2.id, 'C2 Contractor');
    await createTestWorkPackage(c1.id, project1.id, site1.id, con1.id, a1.id, 'C1 Package');
    await createTestWorkPackage(c2.id, project2.id, site2.id, con2.id, a2.id, 'C2 Package');

    const res = await app.inject({
      method: 'GET',
      url: PKGS(project1.id, site1.id),
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.json().packages).toHaveLength(1);
    expect(res.json().packages[0].name).toBe('C1 Package');
  });
});

// ─── Schedule Tasks — create ──────────────────────────────────────────────────

describe('POST /schedule/tasks', () => {
  it('company_admin can create a task with all fields', async () => {
    const { company, admin } = await createTestCompany(app, 'schtask-c1');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const pkg        = await createTestWorkPackage(company.id, project.id, site.id, contractor.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: TASKS(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        contractorId:      contractor.id,
        workPackageId:     pkg.id,
        title:             'Pour Concrete Slab',
        description:       'C25/30 mix, 200mm thick',
        area:              'Level 1',
        materialsRequired: '50m³ ready-mix concrete',
        equipmentRequired: 'Concrete pump, vibrators',
        plannedStartDate:  '2026-04-10',
        plannedEndDate:    '2026-04-12',
        plannedProgress:   0,
      },
    });

    expect(res.statusCode).toBe(201);
    const task = res.json().task;
    expect(task.title).toBe('Pour Concrete Slab');
    expect(task.area).toBe('Level 1');
    expect(task.materialsRequired).toBe('50m³ ready-mix concrete');
    expect(task.status).toBe('not_started');
    expect(task.workPackage.id).toBe(pkg.id);
    expect(task.contractor.id).toBe(contractor.id);
  });

  it('creates task with dependencies', async () => {
    const { company, admin } = await createTestCompany(app, 'schtask-c2');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const taskA      = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: TASKS(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        contractorId:     contractor.id,
        title:            'Task B — depends on A',
        dependsOnTaskIds: [taskA.id],
      },
    });

    expect(res.statusCode).toBe(201);
    const task = res.json().task;
    expect(task.outgoingDeps).toHaveLength(1);
    expect(task.outgoingDeps[0].dependsOnTask.id).toBe(taskA.id);
  });

  it('finance_officer cannot create task — 403', async () => {
    const { company } = await createTestCompany(app, 'schtask-c3');
    const fo          = await createTestUser(app, company.id, 'finance_officer', 'fo-tc3');
    const project     = await createTestProject(company.id);
    const site        = await createTestSite(company.id, project.id);
    const contractor  = await createTestContractor(company.id);

    const res = await app.inject({
      method: 'POST',
      url: TASKS(project.id, site.id),
      headers: { authorization: `Bearer ${fo.accessToken}` },
      payload: { contractorId: contractor.id, title: 'FO Task' },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── Schedule Tasks — update / progress ──────────────────────────────────────

describe('PATCH /schedule/tasks/:taskId', () => {
  it('company_admin can update all task fields', async () => {
    const { company, admin } = await createTestCompany(app, 'schtask-u1');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const task       = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `${TASKS(project.id, site.id)}/${task.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        title:          'Updated Task Title',
        actualProgress: 75,
        status:         'in_progress',
        actualStartDate: '2026-04-05',
      },
    });

    expect(res.statusCode).toBe(200);
    const t = res.json().task;
    expect(t.title).toBe('Updated Task Title');
    expect(t.actualProgress).toBe('75');
    expect(t.status).toBe('in_progress');
  });

  it('site_supervisor can update progress, status, and comments', async () => {
    const { company } = await createTestCompany(app, 'schtask-u2');
    const sup         = await createTestUser(app, company.id, 'site_supervisor', 'sup-u2');
    const project     = await createTestProject(company.id);
    const site        = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const contractor  = await createTestContractor(company.id);
    const task        = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, sup.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `${TASKS(project.id, site.id)}/${task.id}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: {
        actualProgress: 50,
        status:         'in_progress',
        comments:       'Work progressing well',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().task.actualProgress).toBe('50');
    expect(res.json().task.comments).toBe('Work progressing well');
  });

  it('site_supervisor cannot update title or description — 403', async () => {
    const { company } = await createTestCompany(app, 'schtask-u3');
    const sup         = await createTestUser(app, company.id, 'site_supervisor', 'sup-u3');
    const project     = await createTestProject(company.id);
    const site        = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const contractor  = await createTestContractor(company.id);
    const task        = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, sup.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `${TASKS(project.id, site.id)}/${task.id}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { title: 'Supervisor Trying to Change Title' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('can mark task as delayed with a reason', async () => {
    const { company, admin } = await createTestCompany(app, 'schtask-u4');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const task       = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `${TASKS(project.id, site.id)}/${task.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        status:      'delayed',
        delayReason: 'Material delivery delayed by supplier — 5 day impact',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().task.status).toBe('delayed');
    expect(res.json().task.delayReason).toContain('supplier');
  });

  it('audit log records task update', async () => {
    const { company, admin } = await createTestCompany(app, 'schtask-u5');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const task       = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id);

    await app.inject({
      method: 'PATCH',
      url: `${TASKS(project.id, site.id)}/${task.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { status: 'in_progress' },
    });

    const log = await prisma.auditLog.findFirst({
      where: { entityType: 'schedule_task', action: 'update', entityId: task.id },
    });
    expect(log).not.toBeNull();
  });
});

// ─── Dependencies ─────────────────────────────────────────────────────────────

describe('POST /schedule/tasks/:taskId/dependencies', () => {
  it('adds a dependency between two tasks', async () => {
    const { company, admin } = await createTestCompany(app, 'schtask-dep1');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const taskA      = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id, undefined, 'Task A');
    const taskB      = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id, undefined, 'Task B');

    const res = await app.inject({
      method: 'POST',
      url: `${TASKS(project.id, site.id)}/${taskB.id}/dependencies`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { dependsOnTaskId: taskA.id },
    });

    expect(res.statusCode).toBe(201);

    const dep = await prisma.scheduleDependency.findUnique({
      where: { taskId_dependsOnTaskId: { taskId: taskB.id, dependsOnTaskId: taskA.id } },
    });
    expect(dep).not.toBeNull();
  });

  it('rejects self-dependency — 403', async () => {
    const { company, admin } = await createTestCompany(app, 'schtask-dep2');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const task       = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: `${TASKS(project.id, site.id)}/${task.id}/dependencies`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { dependsOnTaskId: task.id },
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── Milestones ───────────────────────────────────────────────────────────────

describe('POST /schedule/tasks/:taskId/milestones', () => {
  it('creates a milestone for a task', async () => {
    const { company, admin } = await createTestCompany(app, 'schmile-c1');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const task       = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id);

    const res = await app.inject({
      method: 'POST',
      url: `${TASKS(project.id, site.id)}/${task.id}/milestones`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        name:        'Slab Pour Complete',
        description: 'All concrete placed and vibrated',
        plannedDate: '2026-04-15',
      },
    });

    expect(res.statusCode).toBe(201);
    const ms = res.json().milestone;
    expect(ms.name).toBe('Slab Pour Complete');
    expect(ms.status).toBe('pending');
  });

  it('marks milestone as completed via PATCH', async () => {
    const { company, admin } = await createTestCompany(app, 'schmile-u1');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const task       = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id);

    const createRes = await app.inject({
      method: 'POST',
      url: `${TASKS(project.id, site.id)}/${task.id}/milestones`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Foundation Approved', plannedDate: '2026-04-10' },
    });
    const { milestone } = createRes.json();

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `${TASKS(project.id, site.id)}/${task.id}/milestones/${milestone.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { status: 'completed', actualDate: '2026-04-10' },
    });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().milestone.status).toBe('completed');
  });
});

// ─── Weekly Plans ─────────────────────────────────────────────────────────────

describe('POST /schedule/weekly-plans', () => {
  it('creates a weekly plan with task items', async () => {
    const { company, admin } = await createTestCompany(app, 'schwp-c1');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const task1      = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id, undefined, 'Task 1');
    const task2      = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id, undefined, 'Task 2');

    const res = await app.inject({
      method: 'POST',
      url: WPLANS(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        contractorId:  contractor.id,
        weekStartDate: '2026-04-07',
        notes:         'Week 15 plan',
        items: [
          { taskId: task1.id, plannedHours: 40, notes: 'Full week' },
          { taskId: task2.id, plannedHours: 20 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const plan = res.json().plan;
    expect(plan.items).toHaveLength(2);
    expect(plan.contractor.id).toBe(contractor.id);
  });

  it('lists weekly plans for a site', async () => {
    const { company, admin } = await createTestCompany(app, 'schwp-l1');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const task       = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id);

    await app.inject({
      method: 'POST',
      url: WPLANS(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        contractorId: contractor.id, weekStartDate: '2026-04-07',
        items: [{ taskId: task.id }],
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: WPLANS(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().plans).toHaveLength(1);
  });
});

// ─── Schedule Summary ─────────────────────────────────────────────────────────

describe('GET /schedule/summary', () => {
  it('returns task status summary for a site', async () => {
    const { company, admin } = await createTestCompany(app, 'schsumm-1');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);

    // Create 4 tasks with different statuses
    const t1 = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id, undefined, 'T1');
    const t2 = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id, undefined, 'T2');
    const t3 = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id, undefined, 'T3');
    await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id, undefined, 'T4');

    await prisma.scheduleTask.update({ where: { id: t1.id }, data: { status: 'in_progress', actualProgress: 60 } });
    await prisma.scheduleTask.update({ where: { id: t2.id }, data: { status: 'completed', actualProgress: 100 } });
    await prisma.scheduleTask.update({ where: { id: t3.id }, data: { status: 'delayed', actualProgress: 30 } });

    const res = await app.inject({
      method: 'GET',
      url: SUMM(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { summary } = res.json();
    expect(summary.tasks.total).toBe(4);
    expect(summary.tasks.inProgress).toBe(1);
    expect(summary.tasks.completed).toBe(1);
    expect(summary.tasks.delayed).toBe(1);
    expect(summary.tasks.notStarted).toBe(1);
    expect(summary.tasks.avgProgress).toBe(63); // (60+100+30)/3 = 63.33 → 63
  });

  it('site not accessible to another company — 404', async () => {
    const { admin: a1 }             = await createTestCompany(app, 'schsumm-2a');
    const { company: c2, admin: a2 } = await createTestCompany(app, 'schsumm-2b');
    const project2 = await createTestProject(c2.id);
    const site2    = await createTestSite(c2.id, project2.id);

    const res = await app.inject({
      method: 'GET',
      url: SUMM(project2.id, site2.id),
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
    void a2; // suppress unused warning
  });
});

// ─── DELETE tasks ─────────────────────────────────────────────────────────────

describe('DELETE /schedule/tasks/:taskId', () => {
  it('company_admin can delete a task', async () => {
    const { company, admin } = await createTestCompany(app, 'schtask-del1');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const task       = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `${TASKS(project.id, site.id)}/${task.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);
    const dbTask = await prisma.scheduleTask.findUnique({ where: { id: task.id } });
    expect(dbTask).toBeNull();
  });

  it('deleting a task also removes its milestones (cascade)', async () => {
    const { company, admin } = await createTestCompany(app, 'schtask-del2');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const task       = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id);

    await prisma.scheduleMilestone.create({
      data: {
        companyId: company.id, projectId: project.id, siteId: site.id,
        taskId: task.id, name: 'Test Milestone',
        plannedDate: new Date('2026-05-01'),
      },
    });

    await app.inject({
      method: 'DELETE',
      url: `${TASKS(project.id, site.id)}/${task.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const ms = await prisma.scheduleMilestone.findFirst({ where: { taskId: task.id } });
    expect(ms).toBeNull();
  });

  it('site_supervisor cannot delete — 403', async () => {
    const { company } = await createTestCompany(app, 'schtask-del3');
    const sup         = await createTestUser(app, company.id, 'site_supervisor', 'sup-d3');
    const project     = await createTestProject(company.id);
    const site        = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const contractor  = await createTestContractor(company.id);
    const task        = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, sup.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `${TASKS(project.id, site.id)}/${task.id}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });
});
