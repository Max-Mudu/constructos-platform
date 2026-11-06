/**
 * Reactivation semantics for project access.
 *
 * Deactivation is a suspension: it signs the user out everywhere (refresh
 * tokens revoked, unused setup/reset links consumed) and authenticate refuses
 * every request while the account is inactive, but it does NOT touch
 * project_members. Reactivation therefore restores exactly the memberships
 * that are still active at that moment:
 *  - memberships that stayed active come back with the user;
 *  - memberships an admin removed while the user was inactive stay removed;
 *  - a default project/site is only a workspace preference — it never grants
 *    access on its own, so a default whose membership was removed is denied.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestProject,
  createTestSite,
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

const PASSWORD = 'ChosenPass1!';
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const get = (token: string, url: string) => app.inject({ method: 'GET', url, headers: auth(token) });

function setStatus(token: string, userId: string, isActive: boolean) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/companies/me/users/${userId}/status`,
    headers: auth(token),
    payload: { isActive },
  });
}

async function login(email: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password: PASSWORD } });
}

/**
 * Creates a site_supervisor through the real API (default project + site and
 * its membership), completes the setup link, and returns a live session.
 */
async function onboardSupervisor(adminToken: string, email: string, projectId: string, siteId: string) {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/companies/me/users',
    headers: auth(adminToken),
    payload: {
      email, firstName: 'Sam', lastName: 'Super', role: 'site_supervisor',
      defaultProjectId: projectId, defaultSiteId: siteId,
    },
  });
  expect(created.statusCode).toBe(201);
  const token = (created.json().setupLink as string).split('token=')[1]!;
  const reset = await app.inject({
    method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: PASSWORD },
  });
  expect(reset.statusCode).toBe(200);
  const res = await login(email);
  expect(res.statusCode).toBe(200);
  return { id: created.json().user.id as string, accessToken: res.json().accessToken as string };
}

async function setup(slug: string) {
  const { company, admin } = await createTestCompany(app, slug);
  const home = await createTestProject(company.id, 'Home Project');
  const homeSite = await createTestSite(company.id, home.id, 'Home Site');
  const other = await createTestProject(company.id, 'Other Project');
  const otherSite = await createTestSite(company.id, other.id, 'Other Site');
  const sup = await onboardSupervisor(admin.accessToken, `sup-${slug}@test.com`, home.id, homeSite.id);
  // A second, still-active membership on another project
  const add = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${other.id}/members`,
    headers: auth(admin.accessToken),
    payload: { userId: sup.id, siteId: otherSite.id },
  });
  expect(add.statusCode).toBe(201);
  return { company, admin, home, homeSite, other, otherSite, sup };
}

describe('reactivation restores only memberships that are still active', () => {
  it('a membership removed while the user was inactive is NOT restored by reactivation', async () => {
    const s = await setup('react-removed');

    expect((await get(s.sup.accessToken, `/api/v1/projects/${s.home.id}`)).statusCode).toBe(200);
    expect((await get(s.sup.accessToken, `/api/v1/projects/${s.other.id}`)).statusCode).toBe(200);

    expect((await setStatus(s.admin.accessToken, s.sup.id, false)).statusCode).toBe(200);

    // Deactivation itself leaves memberships alone (suspend semantics)
    expect(await prisma.projectMember.count({ where: { userId: s.sup.id, removedAt: null } })).toBe(2);

    // While inactive, the admin removes them from the other project
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${s.other.id}/members/${s.sup.id}`,
      headers: auth(s.admin.accessToken),
    });
    expect(del.statusCode).toBe(204);

    const on = await setStatus(s.admin.accessToken, s.sup.id, true);
    expect(on.statusCode).toBe(200);
    expect(on.json().changed).toBe(true);

    // The removed row is still removed; the other one is untouched
    const rows = await prisma.projectMember.findMany({ where: { userId: s.sup.id } });
    expect(rows.find((r) => r.projectId === s.other.id)!.removedAt).not.toBeNull();
    expect(rows.find((r) => r.projectId === s.home.id)!.removedAt).toBeNull();

    // A fresh session after reactivation
    const res = await login(`sup-react-removed@test.com`);
    expect(res.statusCode).toBe(200);
    const token = res.json().accessToken as string;

    // Still-active membership came back with the user …
    expect((await get(token, `/api/v1/projects/${s.home.id}`)).statusCode).toBe(200);
    expect((await get(token, `/api/v1/projects/${s.home.id}/sites/${s.homeSite.id}`)).statusCode).toBe(200);
    // … the removed one did not
    expect((await get(token, `/api/v1/projects/${s.other.id}`)).statusCode).toBe(403);
    expect((await get(token, `/api/v1/projects/${s.other.id}/sites`)).statusCode).toBe(403);
    expect((await get(token, `/api/v1/projects/${s.other.id}/sites/${s.otherSite.id}`)).statusCode).toBe(403);

    const list = await get(token, '/api/v1/projects');
    expect(list.statusCode).toBe(200);
    expect(list.json().projects.map((p: { id: string }) => p.id)).toEqual([s.home.id]);

    // The team list agrees
    const team = await get(s.admin.accessToken, '/api/v1/companies/me/users?role=site_supervisor');
    const row = team.json().users.find((u: { id: string }) => u.id === s.sup.id);
    expect(row.isActive).toBe(true);
    expect(row.projectMemberships.map((m: { projectId: string }) => m.projectId)).toEqual([s.home.id]);
  });

  it('a default project/site without an active membership grants nothing after reactivation', async () => {
    const s = await setup('react-default');

    expect((await setStatus(s.admin.accessToken, s.sup.id, false)).statusCode).toBe(200);
    // Removed from the DEFAULT project while inactive
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${s.home.id}/members/${s.sup.id}`,
      headers: auth(s.admin.accessToken),
    });
    expect(del.statusCode).toBe(204);
    expect((await setStatus(s.admin.accessToken, s.sup.id, true)).statusCode).toBe(200);

    const res = await login('sup-react-default@test.com');
    expect(res.statusCode).toBe(200);
    // The stored preference still names the old workspace …
    expect(res.json().user.defaultProjectId).toBe(s.home.id);
    expect(res.json().user.defaultSiteId).toBe(s.homeSite.id);
    const token = res.json().accessToken as string;

    // … but it does not open anything
    for (const url of [
      `/api/v1/projects/${s.home.id}`,
      `/api/v1/projects/${s.home.id}/sites`,
      `/api/v1/projects/${s.home.id}/sites/${s.homeSite.id}`,
      `/api/v1/projects/${s.home.id}/sites/${s.homeSite.id}/daily-reports`,
      `/api/v1/projects/${s.home.id}/sites/${s.homeSite.id}/attendance`,
      `/api/v1/projects/${s.home.id}/drawings`,
    ]) {
      expect({ url, status: (await get(token, url)).statusCode }).toEqual({ url, status: 403 });
    }
    expect((await get(token, '/api/v1/projects')).json().projects.map((p: { id: string }) => p.id))
      .toEqual([s.other.id]);
    // The other, still-active membership works
    expect((await get(token, `/api/v1/projects/${s.other.id}/sites/${s.otherSite.id}`)).statusCode).toBe(200);
  });

  it('re-adding after reactivation uses only the new scope', async () => {
    const s = await setup('react-readd');
    const otherSite2 = await createTestSite(s.company.id, s.other.id, 'Other Site 2');

    expect((await setStatus(s.admin.accessToken, s.sup.id, false)).statusCode).toBe(200);
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${s.other.id}/members/${s.sup.id}`,
      headers: auth(s.admin.accessToken),
    });
    expect((await setStatus(s.admin.accessToken, s.sup.id, true)).statusCode).toBe(200);

    const add = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${s.other.id}/members`,
      headers: auth(s.admin.accessToken),
      payload: { userId: s.sup.id, siteId: otherSite2.id },
    });
    expect(add.statusCode).toBe(201);

    const token = (await login('sup-react-readd@test.com')).json().accessToken as string;
    const sites = await get(token, `/api/v1/projects/${s.other.id}/sites`);
    expect(sites.json().sites.map((x: { id: string }) => x.id)).toEqual([otherSite2.id]);
    expect((await get(token, `/api/v1/projects/${s.other.id}/sites/${s.otherSite.id}`)).statusCode).toBe(404);
  });
});
