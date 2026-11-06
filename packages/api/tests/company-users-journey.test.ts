/**
 * End-to-end team lifecycle through the public API only:
 * create → list → setup link → sign in → deactivate → reactivate.
 *
 * The individual endpoints have their own focused suites
 * (company-users*.test.ts); this one proves they compose.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { createTestCompany, createTestProject, createTestSite, clearDatabase } from './helpers/fixtures';

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
const get = (token: string, url: string) => app.inject({ method: 'GET', url, headers: auth(token) });
const login = (email: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
const setStatus = (token: string, id: string, isActive: boolean) =>
  app.inject({
    method: 'PATCH', url: `/api/v1/companies/me/users/${id}/status`, headers: auth(token), payload: { isActive },
  });

async function listOne(adminToken: string, id: string, query = '') {
  const res = await get(adminToken, `/api/v1/companies/me/users${query}`);
  expect(res.statusCode).toBe(200);
  return res.json().users.find((u: { id: string }) => u.id === id) as
    | { isActive: boolean; projectMemberships: { projectId: string; siteId: string | null }[] }
    | undefined;
}

describe('company team lifecycle', () => {
  it('create → list → setup link → sign in → deactivate → reactivate', async () => {
    const { company, admin } = await createTestCompany(app, 'journey');
    const project = await createTestProject(company.id, 'Tower');
    const site = await createTestSite(company.id, project.id, 'North');
    const email = 'new.supervisor@test.com';
    const password = 'MyOwnPass1!';

    // 1. Create
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/companies/me/users',
      headers: auth(admin.accessToken),
      payload: {
        email, firstName: 'New', lastName: 'Supervisor', role: 'site_supervisor',
        defaultProjectId: project.id, defaultSiteId: site.id,
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json();
    const userId = body.user.id as string;
    expect(body.user).not.toHaveProperty('passwordHash');
    expect(typeof body.setupLink).toBe('string');
    const setupToken = (body.setupLink as string).split('token=')[1]!;

    // Nobody knows the password yet: the admin cannot sign in as them
    expect((await login(email, 'TestPass1')).statusCode).toBe(401);

    // 2. List: active, with the site-scoped membership created alongside
    const listed = await listOne(admin.accessToken, userId);
    expect(listed).toMatchObject({
      isActive: true,
      projectMemberships: [{ projectId: project.id, siteId: site.id }],
    });

    // 3. Setup link: the user chooses a password; the link is single-use
    const reset = await app.inject({
      method: 'POST', url: '/api/v1/auth/reset-password', payload: { token: setupToken, password },
    });
    expect(reset.statusCode).toBe(200);
    const replay = await app.inject({
      method: 'POST', url: '/api/v1/auth/reset-password', payload: { token: setupToken, password: 'Another1!x' },
    });
    expect(replay.statusCode).toBe(401);

    // 4. Sign in and reach the assigned site
    const first = await login(email, password);
    expect(first.statusCode).toBe(200);
    const token1 = first.json().accessToken as string;
    const refresh1 = first.json().refreshToken as string;
    expect((await get(token1, `/api/v1/projects/${project.id}/sites/${site.id}`)).statusCode).toBe(200);

    // 5. Deactivate: signed out everywhere at once
    const off = await setStatus(admin.accessToken, userId, false);
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ changed: true, user: { id: userId, isActive: false } });
    expect(off.json().refreshTokensRevoked).toBeGreaterThanOrEqual(1);

    expect((await get(token1, '/api/v1/auth/me')).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: refresh1 } })).statusCode).toBe(401);
    expect((await login(email, password)).statusCode).toBe(401);

    expect(await listOne(admin.accessToken, userId, '?isActive=true')).toBeUndefined();
    expect(await listOne(admin.accessToken, userId, '?isActive=false')).toMatchObject({
      isActive: false,
      // Suspension keeps the membership on record
      projectMemberships: [{ projectId: project.id, siteId: site.id }],
    });

    // An admin cannot deactivate themselves (409 with a readable message)
    const self = await setStatus(admin.accessToken, admin.id, false);
    expect(self.statusCode).toBe(409);
    expect(self.json().error).toMatch(/your own account/i);

    // 6. Reactivate: same password, same still-active membership
    const on = await setStatus(admin.accessToken, userId, true);
    expect(on.statusCode).toBe(200);
    expect(on.json()).toMatchObject({ changed: true, user: { isActive: true } });

    const second = await login(email, password);
    expect(second.statusCode).toBe(200);
    const token2 = second.json().accessToken as string;
    expect((await get(token2, `/api/v1/projects/${project.id}/sites/${site.id}`)).statusCode).toBe(200);
    // The pre-deactivation refresh token is not revived
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: refresh1 } })).statusCode).toBe(401);

    expect(await listOne(admin.accessToken, userId, '?isActive=true')).toMatchObject({ isActive: true });

    // Audit trail of the whole lifecycle
    const logs = await prisma.auditLog.findMany({
      where: { companyId: company.id, entityType: 'user', entityId: userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => [l.action, (l.changesAfter as { event?: string } | null)?.event ?? null])).toEqual([
      ['create', null],
      ['update', 'user_deactivated'],
      ['update', 'user_reactivated'],
    ]);
  });
});
