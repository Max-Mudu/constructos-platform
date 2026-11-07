/**
 * NEEDS OWNER APPROVAL — authentication behaviour change.
 *
 * Every user has a session version (users.sessionVersion). Access tokens carry
 * it as `sv` and refresh tokens store it. Deactivating a user increments it, so
 * every access and refresh token issued before the deactivation is refused
 * from then on, including after the account is reactivated. A fresh login
 * after reactivation issues tokens under the new version.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { clearDatabase, createTestCompany, createTestUser } from './helpers/fixtures';

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

interface Session { accessToken: string; refreshToken: string }

async function login(email: string): Promise<Session> {
  const res = await app.inject({
    method:  'POST',
    url:     '/api/v1/auth/login',
    payload: { email, password: 'TestPass1' },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  return { accessToken: body.accessToken as string, refreshToken: body.refreshToken as string };
}

const me = (token: string) =>
  app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });

const refresh = (refreshToken: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });

async function setStatus(adminToken: string, userId: string, isActive: boolean): Promise<void> {
  const res = await app.inject({
    method:  'PATCH',
    url:     `/api/v1/companies/me/users/${userId}/status`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { isActive },
  });
  expect(res.statusCode).toBe(200);
}

const sessionVersion = async (userId: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).sessionVersion;

describe('session version: deactivation', () => {
  it('rejects the old access token and refresh token immediately', async () => {
    const { company, admin } = await createTestCompany(app, 'sv-immediate');
    const target = await createTestUser(app, company.id, 'site_supervisor', 'sv-immediate');
    const s = await login(target.email);
    expect((await me(s.accessToken)).statusCode).toBe(200);

    await setStatus(admin.accessToken, target.id, false);

    expect((await me(s.accessToken)).statusCode).toBe(401);
    expect((await me(target.accessToken)).statusCode).toBe(401);
    expect((await refresh(s.refreshToken)).statusCode).toBe(401);
    expect(await sessionVersion(target.id)).toBe(1);
  });
});

describe('session version: reactivation', () => {
  it('keeps tokens issued before the deactivation dead after a rapid reactivation', async () => {
    const { company, admin } = await createTestCompany(app, 'sv-rapid');
    const target = await createTestUser(app, company.id, 'site_supervisor', 'sv-rapid');
    const s = await login(target.email);

    await setStatus(admin.accessToken, target.id, false);
    await setStatus(admin.accessToken, target.id, true);

    // Both the login-issued token (sv = 0) and a token signed without `sv`
    // (pre-existing format) are refused.
    expect((await me(s.accessToken)).statusCode).toBe(401);
    expect((await me(target.accessToken)).statusCode).toBe(401);
    expect((await refresh(s.refreshToken)).statusCode).toBe(401);
  });

  it('allows a fresh login straight after reactivation, and its tokens work', async () => {
    const { company, admin } = await createTestCompany(app, 'sv-fresh');
    const target = await createTestUser(app, company.id, 'viewer', 'sv-fresh');
    const old = await login(target.email);

    await setStatus(admin.accessToken, target.id, false);
    await setStatus(admin.accessToken, target.id, true);

    // Same second as the reactivation: a version counter has no timing window.
    const fresh = await login(target.email);
    const res = await me(fresh.accessToken);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(target.id);

    const rotated = await refresh(fresh.refreshToken);
    expect(rotated.statusCode).toBe(200);
    expect((await me(rotated.json().accessToken as string)).statusCode).toBe(200);

    expect((await me(old.accessToken)).statusCode).toBe(401);
  });

  it('keeps stale tokens dead across a deactivate / reactivate / deactivate cycle', async () => {
    const { company, admin } = await createTestCompany(app, 'sv-cycle');
    const target = await createTestUser(app, company.id, 'project_manager', 'sv-cycle');
    const first = await login(target.email);

    await setStatus(admin.accessToken, target.id, false);
    await setStatus(admin.accessToken, target.id, true);
    const second = await login(target.email);
    expect((await me(second.accessToken)).statusCode).toBe(200);
    expect((await me(first.accessToken)).statusCode).toBe(401);

    await setStatus(admin.accessToken, target.id, false);
    expect((await me(first.accessToken)).statusCode).toBe(401);
    expect((await me(second.accessToken)).statusCode).toBe(401);

    await setStatus(admin.accessToken, target.id, true);
    expect((await me(first.accessToken)).statusCode).toBe(401);
    expect((await me(second.accessToken)).statusCode).toBe(401);
    expect((await refresh(second.refreshToken)).statusCode).toBe(401);

    const third = await login(target.email);
    expect((await me(third.accessToken)).statusCode).toBe(200);
    expect(await sessionVersion(target.id)).toBe(2);
  });

  it('refuses a refresh token from an older session version even if it was never revoked', async () => {
    const { company, admin } = await createTestCompany(app, 'sv-refresh');
    const target = await createTestUser(app, company.id, 'viewer', 'sv-refresh');
    const s = await login(target.email);

    await setStatus(admin.accessToken, target.id, false);
    await setStatus(admin.accessToken, target.id, true);
    // Second line of defence: clear the revocation by hand; the version check
    // alone must still refuse the token.
    await prisma.refreshToken.updateMany({ where: { userId: target.id }, data: { revokedAt: null } });

    expect((await refresh(s.refreshToken)).statusCode).toBe(401);
  });

  it('rejects an access token whose sv claim is not an integer', async () => {
    const { admin } = await createTestCompany(app, 'sv-bad-claim');
    const base = {
      sub: admin.id, email: admin.email, role: admin.role,
      companyId: admin.companyId, canViewFinance: admin.canViewFinance,
    };
    for (const sv of ['0', 0.5, null, {}]) {
      const token = app.jwt.sign({ ...base, sv } as unknown as Parameters<typeof app.jwt.sign>[0]);
      expect({ sv, status: (await me(token)).statusCode }).toEqual({ sv, status: 401 });
    }
    expect((await me(app.jwt.sign({ ...base, sv: 0 }))).statusCode).toBe(200);
  });
});

describe('session version: isolation', () => {
  it('affects only the deactivated user, not others in the same or another company', async () => {
    const a = await createTestCompany(app, 'sv-iso-a');
    const b = await createTestCompany(app, 'sv-iso-b');
    const target = await createTestUser(app, a.company.id, 'site_supervisor', 'sv-iso-target');
    const peer   = await createTestUser(app, a.company.id, 'site_supervisor', 'sv-iso-peer');
    const other  = await createTestUser(app, b.company.id, 'site_supervisor', 'sv-iso-other');

    const peerSession  = await login(peer.email);
    const otherSession = await login(other.email);
    const bAdminSession = await login(b.admin.email);

    await setStatus(a.admin.accessToken, target.id, false);
    await setStatus(a.admin.accessToken, target.id, true);

    for (const u of [a.admin, peer, other, b.admin]) {
      expect(await sessionVersion(u.id)).toBe(0);
      expect((await me(u.accessToken)).statusCode).toBe(200);
    }
    for (const s of [peerSession, otherSession, bAdminSession]) {
      expect((await me(s.accessToken)).statusCode).toBe(200);
      expect((await refresh(s.refreshToken)).statusCode).toBe(200);
    }
    expect(await sessionVersion(target.id)).toBe(1);
  });
});
