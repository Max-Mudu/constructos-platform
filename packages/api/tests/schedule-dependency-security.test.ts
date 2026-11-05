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

const DEP = (pid: string, sid: string, taskId: string, depTaskId: string) =>
  `/api/v1/projects/${pid}/sites/${sid}/schedule/tasks/${taskId}/dependencies/${depTaskId}`;

/** Creates two tasks on a site with taskB depending on taskA. */
async function seedDependency(companyId: string, projectId: string, siteId: string, createdById: string) {
  const contractor = await createTestContractor(companyId);
  const taskA = await createTestScheduleTask(companyId, projectId, siteId, contractor.id, createdById, undefined, 'Task A');
  const taskB = await createTestScheduleTask(companyId, projectId, siteId, contractor.id, createdById, undefined, 'Task B');
  await prisma.scheduleDependency.create({
    data: { companyId, taskId: taskB.id, dependsOnTaskId: taskA.id },
  });
  return { taskA, taskB };
}

async function dependencyExists(taskId: string, dependsOnTaskId: string): Promise<boolean> {
  const dep = await prisma.scheduleDependency.findUnique({
    where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
  });
  return dep !== null;
}

describe('DELETE /schedule/tasks/:taskId/dependencies/:depTaskId — authorization', () => {
  it('company_admin removes a dependency in their own project/site — 204', async () => {
    const { company, admin } = await createTestCompany(app, 'depsec-own');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const { taskA, taskB } = await seedDependency(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: DEP(project.id, site.id, taskB.id, taskA.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);
    expect(await dependencyExists(taskB.id, taskA.id)).toBe(false);
  });

  it('cannot delete another company\'s dependency through its own project/site URL — 404, row unchanged', async () => {
    const victim   = await createTestCompany(app, 'depsec-victim');
    const vProject = await createTestProject(victim.company.id);
    const vSite    = await createTestSite(victim.company.id, vProject.id);
    const { taskA, taskB } = await seedDependency(victim.company.id, vProject.id, vSite.id, victim.admin.id);

    const attacker = await createTestCompany(app, 'depsec-attacker');
    const aProject = await createTestProject(attacker.company.id);
    const aSite    = await createTestSite(attacker.company.id, aProject.id);

    const res = await app.inject({
      method: 'DELETE',
      url: DEP(aProject.id, aSite.id, taskB.id, taskA.id),
      headers: { authorization: `Bearer ${attacker.admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(await dependencyExists(taskB.id, taskA.id)).toBe(true);
  });

  it('PM of Project A cannot delete a Project B dependency through Project A\'s URL — 404, row unchanged', async () => {
    const { company, admin } = await createTestCompany(app, 'depsec-xproj');
    const projectA = await createTestProject(company.id, 'Project A');
    const siteA    = await createTestSite(company.id, projectA.id, 'Site A');
    const projectB = await createTestProject(company.id, 'Project B');
    const siteB    = await createTestSite(company.id, projectB.id, 'Site B');
    const { taskA, taskB } = await seedDependency(company.id, projectB.id, siteB.id, admin.id);

    const pm = await createTestUser(app, company.id, 'project_manager', 'depsec-xproj');
    await assignUserToProject(company.id, projectA.id, pm.id);

    const viaOwnSite = await app.inject({
      method: 'DELETE',
      url: DEP(projectA.id, siteA.id, taskB.id, taskA.id),
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });
    expect(viaOwnSite.statusCode).toBe(404);

    // Mixing the authorised project with the foreign project's site must not work either
    const viaForeignSite = await app.inject({
      method: 'DELETE',
      url: DEP(projectA.id, siteB.id, taskB.id, taskA.id),
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });
    expect(viaForeignSite.statusCode).toBe(404);

    expect(await dependencyExists(taskB.id, taskA.id)).toBe(true);
  });

  it('PM who is not a member of Project B is rejected on Project B\'s URL — 403, row unchanged', async () => {
    const { company, admin } = await createTestCompany(app, 'depsec-nonmember');
    const projectA = await createTestProject(company.id, 'Project A');
    const projectB = await createTestProject(company.id, 'Project B');
    const siteB    = await createTestSite(company.id, projectB.id, 'Site B');
    const { taskA, taskB } = await seedDependency(company.id, projectB.id, siteB.id, admin.id);

    const pm = await createTestUser(app, company.id, 'project_manager', 'depsec-nonmember');
    await assignUserToProject(company.id, projectA.id, pm.id);

    const res = await app.inject({
      method: 'DELETE',
      url: DEP(projectB.id, siteB.id, taskB.id, taskA.id),
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(await dependencyExists(taskB.id, taskA.id)).toBe(true);
  });

  it('PM who is a member of Project B can remove its dependency — 204', async () => {
    const { company, admin } = await createTestCompany(app, 'depsec-member');
    const projectB = await createTestProject(company.id, 'Project B');
    const siteB    = await createTestSite(company.id, projectB.id, 'Site B');
    const { taskA, taskB } = await seedDependency(company.id, projectB.id, siteB.id, admin.id);

    const pm = await createTestUser(app, company.id, 'project_manager', 'depsec-member');
    await assignUserToProject(company.id, projectB.id, pm.id);

    const res = await app.inject({
      method: 'DELETE',
      url: DEP(projectB.id, siteB.id, taskB.id, taskA.id),
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(204);
    expect(await dependencyExists(taskB.id, taskA.id)).toBe(false);
  });

  it('cannot delete a dependency from a different site of the same project via another site\'s URL — 404', async () => {
    const { company, admin } = await createTestCompany(app, 'depsec-xsite');
    const project = await createTestProject(company.id);
    const site1   = await createTestSite(company.id, project.id, 'Site 1');
    const site2   = await createTestSite(company.id, project.id, 'Site 2');
    const { taskA, taskB } = await seedDependency(company.id, project.id, site2.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: DEP(project.id, site1.id, taskB.id, taskA.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
    expect(await dependencyExists(taskB.id, taskA.id)).toBe(true);
  });

  it('returns 404 for a dependency that does not exist', async () => {
    const { company, admin } = await createTestCompany(app, 'depsec-missing');
    const project    = await createTestProject(company.id);
    const site       = await createTestSite(company.id, project.id);
    const contractor = await createTestContractor(company.id);
    const taskA = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id, undefined, 'Task A');
    const taskB = await createTestScheduleTask(company.id, project.id, site.id, contractor.id, admin.id, undefined, 'Task B');

    const res = await app.inject({
      method: 'DELETE',
      url: DEP(project.id, site.id, taskB.id, taskA.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('a removed dependency can be added again — schedule behaviour intact', async () => {
    const { company, admin } = await createTestCompany(app, 'depsec-readd');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const { taskA, taskB } = await seedDependency(company.id, project.id, site.id, admin.id);

    const del = await app.inject({
      method: 'DELETE',
      url: DEP(project.id, site.id, taskB.id, taskA.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(del.statusCode).toBe(204);

    const add = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${project.id}/sites/${site.id}/schedule/tasks/${taskB.id}/dependencies`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { dependsOnTaskId: taskA.id },
    });
    expect(add.statusCode).toBe(201);
    expect(await dependencyExists(taskB.id, taskA.id)).toBe(true);
  });
});
