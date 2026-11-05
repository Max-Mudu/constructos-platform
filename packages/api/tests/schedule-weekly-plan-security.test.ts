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

const WPLANS = (pid: string, sid: string) => `/api/v1/projects/${pid}/sites/${sid}/schedule/weekly-plans`;

const SECRET_TITLE = 'VICTIM-CONFIDENTIAL-TASK';

/** A company/project/site/contractor a caller is fully authorised for. */
async function seedWorkspace(suffix: string) {
  const { company, admin } = await createTestCompany(app, suffix);
  const project    = await createTestProject(company.id);
  const site       = await createTestSite(company.id, project.id);
  const contractor = await createTestContractor(company.id);
  const task       = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id, undefined, 'Own Task');
  return { company, admin, project, site, contractor, task };
}

async function planCountFor(siteId: string): Promise<number> {
  return prisma.weeklyPlan.count({ where: { siteId } });
}

describe('POST /schedule/weekly-plans — task reference authorization', () => {
  it('accepts tasks from the caller\'s own company, project and site — 201', async () => {
    const own = await seedWorkspace('wpsec-own');

    const res = await app.inject({
      method: 'POST',
      url: WPLANS(own.project.id, own.site.id),
      headers: { authorization: `Bearer ${own.admin.accessToken}` },
      payload: { contractorId: own.contractor.id, weekStartDate: '2026-04-06', items: [{ taskId: own.task.id, plannedHours: 16 }] },
    });

    expect(res.statusCode).toBe(201);
    const plan = res.json().plan;
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].task.id).toBe(own.task.id);
    expect(plan.items[0].task.title).toBe('Own Task');
  });

  it('rejects another company\'s task — 404, no details disclosed, nothing persisted', async () => {
    const victim     = await seedWorkspace('wpsec-victim');
    const victimTask = await createTestScheduleTask(
      victim.company.id, victim.project.id, victim.site.id, victim.contractor.id, victim.admin.id, undefined, SECRET_TITLE,
    );
    const attacker = await seedWorkspace('wpsec-attacker');

    const res = await app.inject({
      method: 'POST',
      url: WPLANS(attacker.project.id, attacker.site.id),
      headers: { authorization: `Bearer ${attacker.admin.accessToken}` },
      payload: { contractorId: attacker.contractor.id, weekStartDate: '2026-04-06', items: [{ taskId: victimTask.id }] },
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(SECRET_TITLE);
    expect(res.body).not.toContain('not_started');
    expect(await planCountFor(attacker.site.id)).toBe(0);
    expect(await prisma.weeklyPlanItem.count({ where: { taskId: victimTask.id } })).toBe(0);
  });

  it('rejects a task from another project in the same company — 404 via own site and via the foreign site', async () => {
    const { company, admin } = await createTestCompany(app, 'wpsec-xproj');
    const projectA   = await createTestProject(company.id, 'Project A');
    const siteA      = await createTestSite(company.id, projectA.id, 'Site A');
    const projectB   = await createTestProject(company.id, 'Project B');
    const siteB      = await createTestSite(company.id, projectB.id, 'Site B');
    const contractor = await createTestContractor(company.id);
    const taskB      = await createTestScheduleTask(company.id, projectB.id, siteB.id, contractor.id, admin.id, undefined, SECRET_TITLE);

    const pm = await createTestUser(app, company.id, 'project_manager', 'wpsec-xproj');
    await assignUserToProject(company.id, projectA.id, pm.id);

    for (const siteId of [siteA.id, siteB.id]) {
      const res = await app.inject({
        method: 'POST',
        url: WPLANS(projectA.id, siteId),
        headers: { authorization: `Bearer ${pm.accessToken}` },
        payload: { contractorId: contractor.id, weekStartDate: '2026-04-06', items: [{ taskId: taskB.id }] },
      });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(SECRET_TITLE);
    }

    expect(await prisma.weeklyPlan.count({ where: { companyId: company.id } })).toBe(0);
  });

  it('rejects a task from another site of the same project — 404', async () => {
    const { company, admin } = await createTestCompany(app, 'wpsec-xsite');
    const project    = await createTestProject(company.id);
    const site1      = await createTestSite(company.id, project.id, 'Site 1');
    const site2      = await createTestSite(company.id, project.id, 'Site 2');
    const contractor = await createTestContractor(company.id);
    const site2Task  = await createTestScheduleTask(company.id, project.id, site2.id, contractor.id, admin.id, undefined, SECRET_TITLE);

    const res = await app.inject({
      method: 'POST',
      url: WPLANS(project.id, site1.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { contractorId: contractor.id, weekStartDate: '2026-04-06', items: [{ taskId: site2Task.id }] },
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(SECRET_TITLE);
    expect(await planCountFor(site1.id)).toBe(0);
  });

  it('rejects a nonexistent task id — 404', async () => {
    const own = await seedWorkspace('wpsec-missing');

    const res = await app.inject({
      method: 'POST',
      url: WPLANS(own.project.id, own.site.id),
      headers: { authorization: `Bearer ${own.admin.accessToken}` },
      payload: { contractorId: own.contractor.id, weekStartDate: '2026-04-06', items: [{ taskId: '00000000-0000-4000-8000-000000000000' }] },
    });

    expect(res.statusCode).toBe(404);
    expect(await planCountFor(own.site.id)).toBe(0);
  });

  it('rejects a mixed list atomically — no plan and no items persisted', async () => {
    const victim     = await seedWorkspace('wpsec-mix-victim');
    const victimTask = await createTestScheduleTask(
      victim.company.id, victim.project.id, victim.site.id, victim.contractor.id, victim.admin.id, undefined, SECRET_TITLE,
    );
    const own = await seedWorkspace('wpsec-mix-own');

    const res = await app.inject({
      method: 'POST',
      url: WPLANS(own.project.id, own.site.id),
      headers: { authorization: `Bearer ${own.admin.accessToken}` },
      payload: {
        contractorId: own.contractor.id,
        weekStartDate: '2026-04-06',
        items: [{ taskId: own.task.id }, { taskId: victimTask.id }],
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(SECRET_TITLE);
    expect(await planCountFor(own.site.id)).toBe(0);
    expect(await prisma.weeklyPlanItem.count({ where: { taskId: { in: [own.task.id, victimTask.id] } } })).toBe(0);
  });

  it('gives an inaccessible existing task the same response as a nonexistent one', async () => {
    const victim     = await seedWorkspace('wpsec-oracle-victim');
    const victimTask = await createTestScheduleTask(
      victim.company.id, victim.project.id, victim.site.id, victim.contractor.id, victim.admin.id, undefined, SECRET_TITLE,
    );
    const attacker = await seedWorkspace('wpsec-oracle-attacker');

    const post = (taskId: string) => app.inject({
      method: 'POST',
      url: WPLANS(attacker.project.id, attacker.site.id),
      headers: { authorization: `Bearer ${attacker.admin.accessToken}` },
      payload: { contractorId: attacker.contractor.id, weekStartDate: '2026-04-06', items: [{ taskId }] },
    });

    const existing = await post(victimTask.id);
    const missing  = await post('00000000-0000-4000-8000-000000000000');

    expect(existing.statusCode).toBe(missing.statusCode);
    expect(existing.json()).toEqual(missing.json());
  });

  it('a valid plan stays readable through list and get without foreign task data', async () => {
    const victim = await seedWorkspace('wpsec-read-victim');
    await createTestScheduleTask(
      victim.company.id, victim.project.id, victim.site.id, victim.contractor.id, victim.admin.id, undefined, SECRET_TITLE,
    );
    const own = await seedWorkspace('wpsec-read-own');

    const created = await app.inject({
      method: 'POST',
      url: WPLANS(own.project.id, own.site.id),
      headers: { authorization: `Bearer ${own.admin.accessToken}` },
      payload: { contractorId: own.contractor.id, weekStartDate: '2026-04-06', items: [{ taskId: own.task.id }] },
    });
    expect(created.statusCode).toBe(201);
    const planId = created.json().plan.id;

    const list = await app.inject({
      method: 'GET',
      url: WPLANS(own.project.id, own.site.id),
      headers: { authorization: `Bearer ${own.admin.accessToken}` },
    });
    const get = await app.inject({
      method: 'GET',
      url: `${WPLANS(own.project.id, own.site.id)}/${planId}`,
      headers: { authorization: `Bearer ${own.admin.accessToken}` },
    });

    expect(list.statusCode).toBe(200);
    expect(list.json().plans).toHaveLength(1);
    expect(get.statusCode).toBe(200);
    expect(get.json().plan.items[0].task.id).toBe(own.task.id);
    expect(list.body).not.toContain(SECRET_TITLE);
    expect(get.body).not.toContain(SECRET_TITLE);
  });
});
