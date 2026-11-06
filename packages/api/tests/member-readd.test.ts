/**
 * Re-adding a project member after removal.
 *
 * removeMember soft-deletes (removedAt = now) and (projectId, userId) is
 * unique, so a re-add must restore that row rather than insert a second one.
 * The restored membership takes the scope given in the NEW request only.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
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

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

function addMember(token: string, projectId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/members`,
    headers: auth(token),
    payload,
  });
}

function removeMember(token: string, projectId: string, userId: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/v1/projects/${projectId}/members/${userId}`,
    headers: auth(token),
  });
}

const get = (token: string, url: string) => app.inject({ method: 'GET', url, headers: auth(token) });

async function setup(slug: string) {
  const { company, admin } = await createTestCompany(app, slug);
  const project = await createTestProject(company.id);
  const siteA = await createTestSite(company.id, project.id, 'Site A');
  const siteB = await createTestSite(company.id, project.id, 'Site B');
  const sup = await createTestUser(app, company.id, 'site_supervisor', `${slug}-sup`);
  return { company, admin, project, siteA, siteB, sup };
}

describe('POST /projects/:projectId/members — re-adding a removed member', () => {
  it('restores the removed row with the NEW siteId instead of failing', async () => {
    const s = await setup('readd-basic');

    const first = await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteA.id });
    expect(first.statusCode).toBe(201);
    const rowId = first.json().member.id as string;

    expect((await removeMember(s.admin.accessToken, s.project.id, s.sup.id)).statusCode).toBe(204);

    const again = await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteB.id });
    expect(again.statusCode).toBe(201);
    const member = again.json().member;
    expect(member).toMatchObject({
      id: rowId,
      projectId: s.project.id,
      userId: s.sup.id,
      siteId: s.siteB.id,
      removedAt: null,
      site: { id: s.siteB.id, name: 'Site B' },
    });
    expect(member.user).not.toHaveProperty('passwordHash');

    // Still exactly one row for the pair, now active and on the new site
    const rows = await prisma.projectMember.findMany({ where: { projectId: s.project.id, userId: s.sup.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.removedAt).toBeNull();
    expect(rows[0]!.siteId).toBe(s.siteB.id);
    expect(rows[0]!.companyId).toBe(s.company.id);

    // And they are listed again
    const list = await get(s.admin.accessToken, `/api/v1/projects/${s.project.id}/members`);
    expect(list.json().members.map((m: { userId: string }) => m.userId)).toEqual([s.sup.id]);
  });

  it('re-adding without a siteId restores a project-wide membership', async () => {
    const s = await setup('readd-wide');
    await assignUserToProject(s.company.id, s.project.id, s.sup.id, s.siteA.id);
    expect((await removeMember(s.admin.accessToken, s.project.id, s.sup.id)).statusCode).toBe(204);

    const again = await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id });
    expect(again.statusCode).toBe(201);
    expect(again.json().member.siteId).toBeNull();
  });

  it('can be removed and re-added repeatedly', async () => {
    const s = await setup('readd-repeat');
    for (const site of [s.siteA, s.siteB, s.siteA]) {
      expect((await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: site.id })).statusCode).toBe(201);
      expect((await removeMember(s.admin.accessToken, s.project.id, s.sup.id)).statusCode).toBe(204);
    }
    expect(await prisma.projectMember.count({ where: { projectId: s.project.id, userId: s.sup.id } })).toBe(1);
  });

  it('writes a member_readded audit row with the previous and new scope', async () => {
    const s = await setup('readd-audit');
    await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteA.id });
    await removeMember(s.admin.accessToken, s.project.id, s.sup.id);
    const again = await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteB.id });
    const rowId = again.json().member.id as string;

    const logs = await prisma.auditLog.findMany({
      where: { entityType: 'project_member', entityId: rowId },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => l.action)).toEqual(['create', 'delete', 'create']);
    const readd = logs[2]!;
    expect(readd.userId).toBe(s.admin.id);
    expect(readd.companyId).toBe(s.company.id);
    expect(readd.changesBefore).toMatchObject({ siteId: s.siteA.id });
    expect((readd.changesBefore as { removedAt: string | null }).removedAt).not.toBeNull();
    expect(readd.changesAfter).toMatchObject({
      event: 'member_readded',
      projectId: s.project.id,
      addedUserId: s.sup.id,
      siteId: s.siteB.id,
    });
  });

  it('still answers 409 for an ACTIVE member and leaves their scope untouched', async () => {
    const s = await setup('readd-active');
    expect((await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteA.id })).statusCode).toBe(201);

    const dup = await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteB.id });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('CONFLICT');

    const row = await prisma.projectMember.findFirstOrThrow({ where: { projectId: s.project.id, userId: s.sup.id } });
    expect(row.siteId).toBe(s.siteA.id);
    expect(row.removedAt).toBeNull();
  });

  it('concurrent adds of the same user yield one success and one 409, never a 500', async () => {
    const s = await setup('readd-race');
    const [x, y] = await Promise.all([
      addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteA.id }),
      addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteB.id }),
    ]);
    expect([x.statusCode, y.statusCode].sort()).toEqual([201, 409]);

    await removeMember(s.admin.accessToken, s.project.id, s.sup.id);
    const [p, q] = await Promise.all([
      addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteA.id }),
      addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteB.id }),
    ]);
    expect([p.statusCode, q.statusCode].sort()).toEqual([201, 409]);
    expect(await prisma.projectMember.count({ where: { projectId: s.project.id, userId: s.sup.id } })).toBe(1);
  });

  it('cross-company: another tenant cannot re-add (404) and the removed row stays removed', async () => {
    const s = await setup('readd-tenant-a');
    const b = await createTestCompany(app, 'readd-tenant-b');
    const bProject = await createTestProject(b.company.id, 'B Project');
    const bSite = await createTestSite(b.company.id, bProject.id, 'B Site');

    await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteA.id });
    await removeMember(s.admin.accessToken, s.project.id, s.sup.id);

    // B's admin targeting A's project, and B's admin targeting A's user on B's project
    expect((await addMember(b.admin.accessToken, s.project.id, { userId: s.sup.id })).statusCode).toBe(404);
    expect((await addMember(b.admin.accessToken, bProject.id, { userId: s.sup.id, siteId: bSite.id })).statusCode).toBe(404);
    // A's admin using B's site on A's project
    expect((await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: bSite.id })).statusCode).toBe(404);

    const rows = await prisma.projectMember.findMany({ where: { userId: s.sup.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.removedAt).not.toBeNull();
    expect(rows[0]!.siteId).toBe(s.siteA.id);
  });

  it('refuses to re-add a user who has been deactivated (404)', async () => {
    const s = await setup('readd-inactive');
    await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteA.id });
    await removeMember(s.admin.accessToken, s.project.id, s.sup.id);
    await prisma.user.update({ where: { id: s.sup.id }, data: { isActive: false } });

    expect((await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteA.id })).statusCode).toBe(404);
    expect((await prisma.projectMember.findFirstOrThrow({ where: { userId: s.sup.id } })).removedAt).not.toBeNull();
  });

  it.each(['project_manager', 'finance_officer', 'site_supervisor', 'contractor', 'consultant', 'viewer'] as const)(
    '%s still cannot re-add a removed member (403)',
    async (role) => {
      const s = await setup(`readd-403-${role}`);
      const actor = await createTestUser(app, s.company.id, role, `readd-403-${role}-actor`, {
        canViewFinance: role === 'finance_officer',
      });
      await assignUserToProject(s.company.id, s.project.id, actor.id);
      await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteA.id });
      await removeMember(s.admin.accessToken, s.project.id, s.sup.id);

      expect((await addMember(actor.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteB.id })).statusCode).toBe(403);
      expect((await prisma.projectMember.findFirstOrThrow({ where: { userId: s.sup.id } })).removedAt).not.toBeNull();
    },
  );
});

describe('re-added member access follows the new site scope only', () => {
  it('a supervisor moved from Site A to Site B sees only Site B', async () => {
    const s = await setup('readd-scope');
    await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteA.id });

    const sitesBefore = await get(s.sup.accessToken, `/api/v1/projects/${s.project.id}/sites`);
    expect(sitesBefore.json().sites.map((x: { id: string }) => x.id)).toEqual([s.siteA.id]);

    await removeMember(s.admin.accessToken, s.project.id, s.sup.id);
    // Removed: no project access at all
    expect((await get(s.sup.accessToken, `/api/v1/projects/${s.project.id}`)).statusCode).toBe(403);
    expect((await get(s.sup.accessToken, `/api/v1/projects/${s.project.id}/sites`)).statusCode).toBe(403);

    await addMember(s.admin.accessToken, s.project.id, { userId: s.sup.id, siteId: s.siteB.id });

    expect((await get(s.sup.accessToken, `/api/v1/projects/${s.project.id}`)).statusCode).toBe(200);
    const sitesAfter = await get(s.sup.accessToken, `/api/v1/projects/${s.project.id}/sites`);
    expect(sitesAfter.statusCode).toBe(200);
    expect(sitesAfter.json().sites.map((x: { id: string }) => x.id)).toEqual([s.siteB.id]);
    expect((await get(s.sup.accessToken, `/api/v1/projects/${s.project.id}/sites/${s.siteB.id}`)).statusCode).toBe(200);
    // The old site is no longer reachable
    expect((await get(s.sup.accessToken, `/api/v1/projects/${s.project.id}/sites/${s.siteA.id}`)).statusCode).toBe(404);
  });
});
