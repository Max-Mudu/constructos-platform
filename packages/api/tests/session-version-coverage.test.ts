/**
 * Session version coverage across every place that issues or accepts an
 * access token:
 *  - login, refresh and register all embed the user's current session
 *    version (`sv`) in the access token and store it on the refresh token;
 *  - the live-updates stream (GET /events?token=) applies the same session
 *    version check as the authenticate middleware.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { hashToken } from '../src/utils/hash';
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

async function login(email: string, password = 'TestPass1'): Promise<Session> {
  const res = await app.inject({
    method:  'POST',
    url:     '/api/v1/auth/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  return { accessToken: body.accessToken as string, refreshToken: body.refreshToken as string };
}

const events = (token: string) =>
  app.inject({ method: 'GET', url: `/api/v1/events?token=${token}` });

const svOf = (accessToken: string) =>
  (app.jwt.decode(accessToken) as { sv?: unknown } | null)?.sv;

const storedVersion = async (refreshToken: string) =>
  (await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(refreshToken) } }))
    .sessionVersion;

async function setStatus(adminToken: string, userId: string, isActive: boolean): Promise<void> {
  const res = await app.inject({
    method:  'PATCH',
    url:     `/api/v1/companies/me/users/${userId}/status`,
    headers: { authorization: `Bearer ${adminToken}` },
    payload: { isActive },
  });
  expect(res.statusCode).toBe(200);
}

async function resetPasswordViaLink(email: string, password: string): Promise<void> {
  const forgot = await app.inject({
    method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email },
  });
  const token = (forgot.json().devLink as string).split('token=')[1]!;
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password },
  });
  expect(res.statusCode).toBe(200);
}

describe('every token-issuing path carries the current session version', () => {
  it('register: sv 0 on the access token and the stored refresh token', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/auth/register',
      payload: {
        companyName: 'SV Register Co',
        firstName:   'Reg',
        lastName:    'Ister',
        email:       'sv-register@test.local',
        password:    'TestPass1',
        country:     'Kenya',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(svOf(body.accessToken)).toBe(0);
    expect(await storedVersion(body.refreshToken)).toBe(0);
  });

  it('login and refresh after a version bump carry the new version', async () => {
    const { company, admin } = await createTestCompany(app, 'sv-paths');
    const target = await createTestUser(app, company.id, 'project_manager', 'sv-paths');

    await setStatus(admin.accessToken, target.id, false);
    await setStatus(admin.accessToken, target.id, true);

    const s = await login(target.email);
    expect(svOf(s.accessToken)).toBe(1);
    expect(await storedVersion(s.refreshToken)).toBe(1);

    const res = await app.inject({
      method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: s.refreshToken },
    });
    expect(res.statusCode).toBe(200);
    const rotated = res.json();
    expect(svOf(rotated.accessToken)).toBe(1);
    expect(await storedVersion(rotated.refreshToken)).toBe(1);
  });
});

describe('GET /events applies the session version check', () => {
  it('accepts a current access token', async () => {
    const { company } = await createTestCompany(app, 'sv-evt-ok');
    const target = await createTestUser(app, company.id, 'site_supervisor', 'sv-evt-ok');
    const s = await login(target.email);
    expect((await events(s.accessToken)).statusCode).toBe(200);
  });

  it('refuses an access token issued before a password reset', async () => {
    const { company } = await createTestCompany(app, 'sv-evt-reset');
    const target = await createTestUser(app, company.id, 'site_supervisor', 'sv-evt-reset');
    const s = await login(target.email);

    await resetPasswordViaLink(target.email, 'NewPass123');

    expect((await events(s.accessToken)).statusCode).toBe(401);
    // A token without `sv` counts as version 0 and is refused too.
    expect((await events(target.accessToken)).statusCode).toBe(401);

    const fresh = await login(target.email, 'NewPass123');
    expect((await events(fresh.accessToken)).statusCode).toBe(200);
  });

  it('refuses an access token issued before a deactivation, even after reactivation', async () => {
    const { company, admin } = await createTestCompany(app, 'sv-evt-react');
    const target = await createTestUser(app, company.id, 'project_manager', 'sv-evt-react');
    const s = await login(target.email);

    await setStatus(admin.accessToken, target.id, false);
    await setStatus(admin.accessToken, target.id, true);

    expect((await events(s.accessToken)).statusCode).toBe(401);
  });

  it('refuses a correctly signed token whose sv is not an integer', async () => {
    const { company } = await createTestCompany(app, 'sv-evt-bad');
    const target = await createTestUser(app, company.id, 'site_supervisor', 'sv-evt-bad');
    const forged = app.jwt.sign({
      sub: target.id, email: target.email, role: 'site_supervisor',
      companyId: company.id, canViewFinance: false, sv: '0' as unknown as number,
    });
    expect((await events(forged)).statusCode).toBe(401);
  });
});
