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

const MS = (pid: string, sid: string, taskId: string, milestoneId: string) =>
  `/api/v1/projects/${pid}/sites/${sid}/schedule/tasks/${taskId}/milestones/${milestoneId}`;

const ORIGINAL_NAME = 'Original Milestone';

/** Creates a task with one milestone on the given project/site. */
async function seedMilestone(companyId: string, projectId: string, siteId: string, createdById: string) {
  const contractor = await createTestContractor(companyId);
  const task = await createTestScheduleTask(companyId, projectId, siteId, contractor.id, createdById, undefined, 'Milestone Task');
  const milestone = await prisma.scheduleMilestone.create({
    data: {
      companyId,
      projectId,
      siteId,
      taskId:      task.id,
      name:        ORIGINAL_NAME,
      plannedDate: new Date('2026-05-01'),
    },
  });
  return { task, milestone };
}

async function milestoneName(id: string): Promise<string | null> {
  const m = await prisma.scheduleMilestone.findUnique({ where: { id } });
  return m ? m.name : null;
}

describe('PATCH /schedule/tasks/:taskId/milestones/:milestoneId — authorization', () => {
  it('company_admin updates a milestone in their own project/site — 200', async () => {
    const { company, admin } = await createTestCompany(app, 'mssec-upd-own');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const { task, milestone } = await seedMilestone(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'PATCH',
      url: MS(project.id, site.id, task.id, milestone.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Renamed', status: 'completed', actualDate: '2026-05-02' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().milestone.name).toBe('Renamed');
    expect(res.json().milestone.status).toBe('completed');
    expect(await milestoneName(milestone.id)).toBe('Renamed');
  });

  it('cannot update another company\'s milestone through its own project/site URL — 404, row unchanged', async () => {
    const victim   = await createTestCompany(app, 'mssec-upd-victim');
    const vProject = await createTestProject(victim.company.id);
    const vSite    = await createTestSite(victim.company.id, vProject.id);
    const { task, milestone } = await seedMilestone(victim.company.id, vProject.id, vSite.id, victim.admin.id);

    const attacker = await createTestCompany(app, 'mssec-upd-attacker');
    const aProject = await createTestProject(attacker.company.id);
    const aSite    = await createTestSite(attacker.company.id, aProject.id);

    const res = await app.inject({
      method: 'PATCH',
      url: MS(aProject.id, aSite.id, task.id, milestone.id),
      headers: { authorization: `Bearer ${attacker.admin.accessToken}` },
      payload: { name: 'Hijacked' },
    });

    expect(res.statusCode).toBe(404);
    expect(await milestoneName(milestone.id)).toBe(ORIGINAL_NAME);
  });

  it('PM of Project A cannot update a Project B milestone through Project A\'s URL — 404, row unchanged', async () => {
    const { company, admin } = await createTestCompany(app, 'mssec-upd-xproj');
    const projectA = await createTestProject(company.id, 'Project A');
    const siteA    = await createTestSite(company.id, projectA.id, 'Site A');
    const projectB = await createTestProject(company.id, 'Project B');
    const siteB    = await createTestSite(company.id, projectB.id, 'Site B');
    const { task, milestone } = await seedMilestone(company.id, projectB.id, siteB.id, admin.id);

    const pm = await createTestUser(app, company.id, 'project_manager', 'mssec-upd-xproj');
    await assignUserToProject(company.id, projectA.id, pm.id);

    const viaOwnSite = await app.inject({
      method: 'PATCH',
      url: MS(projectA.id, siteA.id, task.id, milestone.id),
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { name: 'Hijacked via own site' },
    });
    expect(viaOwnSite.statusCode).toBe(404);

    const viaForeignSite = await app.inject({
      method: 'PATCH',
      url: MS(projectA.id, siteB.id, task.id, milestone.id),
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { name: 'Hijacked via foreign site' },
    });
    expect(viaForeignSite.statusCode).toBe(404);

    expect(await milestoneName(milestone.id)).toBe(ORIGINAL_NAME);
  });

  it('cannot update a milestone on a different site of the same project via another site\'s URL — 404', async () => {
    const { company, admin } = await createTestCompany(app, 'mssec-upd-xsite');
    const project = await createTestProject(company.id);
    const site1   = await createTestSite(company.id, project.id, 'Site 1');
    const site2   = await createTestSite(company.id, project.id, 'Site 2');
    const { task, milestone } = await seedMilestone(company.id, project.id, site2.id, admin.id);

    const res = await app.inject({
      method: 'PATCH',
      url: MS(project.id, site1.id, task.id, milestone.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Hijacked' },
    });

    expect(res.statusCode).toBe(404);
    expect(await milestoneName(milestone.id)).toBe(ORIGINAL_NAME);
  });

  it('returns 404 for a milestone that does not exist', async () => {
    const { company, admin } = await createTestCompany(app, 'mssec-upd-missing');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const { task } = await seedMilestone(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'PATCH',
      url: MS(project.id, site.id, task.id, '00000000-0000-4000-8000-000000000000'),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Ghost' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when the milestone is addressed through a different task\'s URL', async () => {
    const { company, admin } = await createTestCompany(app, 'mssec-upd-xtask');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const { milestone } = await seedMilestone(company.id, project.id, site.id, admin.id);
    const contractor = await createTestContractor(company.id, 'Other');
    const otherTask  = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id, undefined, 'Other Task');

    const res = await app.inject({
      method: 'PATCH',
      url: MS(project.id, site.id, otherTask.id, milestone.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Hijacked' },
    });

    expect(res.statusCode).toBe(404);
    expect(await milestoneName(milestone.id)).toBe(ORIGINAL_NAME);
  });
});

describe('DELETE /schedule/tasks/:taskId/milestones/:milestoneId — authorization and audit', () => {
  it('company_admin deletes a milestone in their own project/site — 204 and writes an audit row', async () => {
    const { company, admin } = await createTestCompany(app, 'mssec-del-own');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const { task, milestone } = await seedMilestone(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: MS(project.id, site.id, task.id, milestone.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);
    expect(await milestoneName(milestone.id)).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'schedule_milestone', entityId: milestone.id, action: 'delete' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.companyId).toBe(company.id);
    expect(audit!.userId).toBe(admin.id);
    expect(audit!.userRole).toBe('company_admin');
    expect((audit!.changesBefore as { name?: string } | null)?.name).toBe(ORIGINAL_NAME);
  });

  it('PM member of the project can delete its milestone — 204', async () => {
    const { company, admin } = await createTestCompany(app, 'mssec-del-member');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const { task, milestone } = await seedMilestone(company.id, project.id, site.id, admin.id);

    const pm = await createTestUser(app, company.id, 'project_manager', 'mssec-del-member');
    await assignUserToProject(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'DELETE',
      url: MS(project.id, site.id, task.id, milestone.id),
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(204);
    expect(await milestoneName(milestone.id)).toBeNull();
  });

  it('cannot delete another company\'s milestone through its own project/site URL — 404, row unchanged', async () => {
    const victim   = await createTestCompany(app, 'mssec-del-victim');
    const vProject = await createTestProject(victim.company.id);
    const vSite    = await createTestSite(victim.company.id, vProject.id);
    const { task, milestone } = await seedMilestone(victim.company.id, vProject.id, vSite.id, victim.admin.id);

    const attacker = await createTestCompany(app, 'mssec-del-attacker');
    const aProject = await createTestProject(attacker.company.id);
    const aSite    = await createTestSite(attacker.company.id, aProject.id);

    const res = await app.inject({
      method: 'DELETE',
      url: MS(aProject.id, aSite.id, task.id, milestone.id),
      headers: { authorization: `Bearer ${attacker.admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(await milestoneName(milestone.id)).toBe(ORIGINAL_NAME);
  });

  it('PM of Project A cannot delete a Project B milestone through Project A\'s URL — 404, row unchanged, no audit row', async () => {
    const { company, admin } = await createTestCompany(app, 'mssec-del-xproj');
    const projectA = await createTestProject(company.id, 'Project A');
    const siteA    = await createTestSite(company.id, projectA.id, 'Site A');
    const projectB = await createTestProject(company.id, 'Project B');
    const siteB    = await createTestSite(company.id, projectB.id, 'Site B');
    const { task, milestone } = await seedMilestone(company.id, projectB.id, siteB.id, admin.id);

    const pm = await createTestUser(app, company.id, 'project_manager', 'mssec-del-xproj');
    await assignUserToProject(company.id, projectA.id, pm.id);

    const viaOwnSite = await app.inject({
      method: 'DELETE',
      url: MS(projectA.id, siteA.id, task.id, milestone.id),
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });
    expect(viaOwnSite.statusCode).toBe(404);

    const viaForeignSite = await app.inject({
      method: 'DELETE',
      url: MS(projectA.id, siteB.id, task.id, milestone.id),
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });
    expect(viaForeignSite.statusCode).toBe(404);

    expect(await milestoneName(milestone.id)).toBe(ORIGINAL_NAME);
    expect(await prisma.auditLog.count({
      where: { entityType: 'schedule_milestone', entityId: milestone.id, action: 'delete' },
    })).toBe(0);
  });

  it('cannot delete a milestone on a different site of the same project via another site\'s URL — 404', async () => {
    const { company, admin } = await createTestCompany(app, 'mssec-del-xsite');
    const project = await createTestProject(company.id);
    const site1   = await createTestSite(company.id, project.id, 'Site 1');
    const site2   = await createTestSite(company.id, project.id, 'Site 2');
    const { task, milestone } = await seedMilestone(company.id, project.id, site2.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: MS(project.id, site1.id, task.id, milestone.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(await milestoneName(milestone.id)).toBe(ORIGINAL_NAME);
  });

  it('returns 404 for a milestone that does not exist', async () => {
    const { company, admin } = await createTestCompany(app, 'mssec-del-missing');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const { task } = await seedMilestone(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: MS(project.id, site.id, task.id, '00000000-0000-4000-8000-000000000000'),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
