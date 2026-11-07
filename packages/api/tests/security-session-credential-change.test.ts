/**
 * NEEDS OWNER APPROVAL — authentication behaviour change.
 *
 * Completing a password reset (through a reset link or a setup link)
 * increments users.sessionVersion in the same transaction as the password
 * change, so every access and refresh token issued before the reset is
 * refused from then on. A fresh login with the new password works at once.
 *
 * The API has no route that changes a user's role, finance permission or
 * company after creation, and no authenticated change-password route; the
 * last describe block pins that down so that adding one is a visible change
 * (it must then also increment sessionVersion when the value changes).
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

const me = (token: string) =>
  app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });

const refresh = (refreshToken: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });

async function resetLinkToken(email: string): Promise<string> {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email },
  });
  const devLink: string = res.json().devLink;
  return devLink.split('token=')[1]!;
}

const resetPassword = (token: string, password: string) =>
  app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password } });

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

describe('password reset ends existing sessions', () => {
  it('rejects access tokens issued before the reset', async () => {
    const { company } = await createTestCompany(app, 'cc-access');
    const target = await createTestUser(app, company.id, 'site_supervisor', 'cc-access');
    const s = await login(target.email);
    expect((await me(s.accessToken)).statusCode).toBe(200);

    const token = await resetLinkToken(target.email);
    expect((await resetPassword(token, 'NewPass123')).statusCode).toBe(200);

    expect((await me(s.accessToken)).statusCode).toBe(401);
    // A token without `sv` (version 0) is refused too.
    expect((await me(target.accessToken)).statusCode).toBe(401);
    expect(await sessionVersion(target.id)).toBe(1);
  });

  it('rejects refresh tokens issued before the reset', async () => {
    const { company } = await createTestCompany(app, 'cc-refresh');
    const target = await createTestUser(app, company.id, 'project_manager', 'cc-refresh');
    const s = await login(target.email);

    const token = await resetLinkToken(target.email);
    expect((await resetPassword(token, 'NewPass123')).statusCode).toBe(200);

    expect((await refresh(s.refreshToken)).statusCode).toBe(401);
  });

  it('lets the user log in fresh with the new password right after', async () => {
    const { company } = await createTestCompany(app, 'cc-fresh');
    const target = await createTestUser(app, company.id, 'finance_officer', 'cc-fresh');
    await login(target.email);

    const token = await resetLinkToken(target.email);
    expect((await resetPassword(token, 'NewPass123')).statusCode).toBe(200);

    const old = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { email: target.email, password: 'TestPass1' },
    });
    expect(old.statusCode).toBe(401);

    const fresh = await login(target.email, 'NewPass123');
    expect((await me(fresh.accessToken)).statusCode).toBe(200);
    const rotated = await refresh(fresh.refreshToken);
    expect(rotated.statusCode).toBe(200);
    expect((await me(rotated.json().accessToken as string)).statusCode).toBe(200);
  });

  it('applies to a setup link issued by an admin', async () => {
    const { admin } = await createTestCompany(app, 'cc-setup');
    const created = await app.inject({
      method:  'POST',
      url:     '/api/v1/companies/me/users',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { email: 'new-cc-setup@test.com', firstName: 'New', lastName: 'User', role: 'finance_officer' },
    });
    expect(created.statusCode).toBe(201);
    const userId = created.json().user.id as string;
    const setupToken = (created.json().setupLink as string).split('token=')[1]!;
    const before = await sessionVersion(userId);

    expect((await resetPassword(setupToken, 'ChosenPass1!')).statusCode).toBe(200);
    expect(await sessionVersion(userId)).toBe(before + 1);

    const s = await login('new-cc-setup@test.com', 'ChosenPass1!');
    expect((await me(s.accessToken)).statusCode).toBe(200);
  });

  it('does not change the session version when the reset is refused', async () => {
    const { company } = await createTestCompany(app, 'cc-refused');
    const target = await createTestUser(app, company.id, 'site_supervisor', 'cc-refused');
    const token = await resetLinkToken(target.email);
    expect((await resetPassword(token, 'NewPass123')).statusCode).toBe(200);
    const fresh = await login(target.email, 'NewPass123');

    // Replaying the used link is refused and must not end the new session.
    expect((await resetPassword(token, 'OtherPass1')).statusCode).toBe(401);
    expect((await resetPassword('not-a-real-token', 'OtherPass1')).statusCode).toBe(401);
    expect(await sessionVersion(target.id)).toBe(1);
    expect((await me(fresh.accessToken)).statusCode).toBe(200);
  });

  it('leaves other users in the same and in other companies signed in', async () => {
    const { company, admin } = await createTestCompany(app, 'cc-iso-a');
    const target   = await createTestUser(app, company.id, 'site_supervisor', 'cc-iso-a');
    const neighbour = await createTestUser(app, company.id, 'site_supervisor', 'cc-iso-n');
    const other    = await createTestCompany(app, 'cc-iso-b');

    const neighbourSession = await login(neighbour.email);
    const adminSession     = await login(admin.email);
    const otherSession     = await login(other.admin.email);

    const token = await resetLinkToken(target.email);
    expect((await resetPassword(token, 'NewPass123')).statusCode).toBe(200);

    for (const s of [neighbourSession, adminSession, otherSession]) {
      expect((await me(s.accessToken)).statusCode).toBe(200);
    }
    expect((await refresh(neighbourSession.refreshToken)).statusCode).toBe(200);
    expect((await refresh(otherSession.refreshToken)).statusCode).toBe(200);
    expect(await sessionVersion(neighbour.id)).toBe(0);
    expect(await sessionVersion(admin.id)).toBe(0);
    expect(await sessionVersion(other.admin.id)).toBe(0);
  });
});

describe('deactivation behaviour is unchanged', () => {
  it('still ends sessions on deactivation and does not bump on reactivation', async () => {
    const { company, admin } = await createTestCompany(app, 'cc-deact');
    const target = await createTestUser(app, company.id, 'site_supervisor', 'cc-deact');
    const s = await login(target.email);

    await setStatus(admin.accessToken, target.id, false);
    expect(await sessionVersion(target.id)).toBe(1);
    expect((await me(s.accessToken)).statusCode).toBe(401);
    expect((await refresh(s.refreshToken)).statusCode).toBe(401);

    await setStatus(admin.accessToken, target.id, true);
    expect(await sessionVersion(target.id)).toBe(1);
    const fresh = await login(target.email);
    expect((await me(fresh.accessToken)).statusCode).toBe(200);
  });
});

describe('role, finance permission and company are not editable after creation', () => {
  it('refuses role or finance fields on the status route and keeps sessions', async () => {
    const { company, admin } = await createTestCompany(app, 'cc-role');
    const target = await createTestUser(app, company.id, 'project_manager', 'cc-role');
    const s = await login(target.email);

    for (const payload of [
      { isActive: true, role: 'company_admin' },
      { isActive: true, canViewFinance: true },
      { isActive: true, companyId: '00000000-0000-0000-0000-000000000000' },
    ]) {
      const res = await app.inject({
        method:  'PATCH',
        url:     `/api/v1/companies/me/users/${target.id}/status`,
        headers: { authorization: `Bearer ${admin.accessToken}` },
        payload,
      });
      expect(res.statusCode).toBe(422);
    }

    const row = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.role).toBe('project_manager');
    expect(row.canViewFinance).toBe(false);
    expect(row.companyId).toBe(company.id);
    expect(row.sessionVersion).toBe(0);
    expect((await me(s.accessToken)).statusCode).toBe(200);
  });

  it('a company settings update does not end anyone\'s sessions', async () => {
    const { company, admin } = await createTestCompany(app, 'cc-company');
    const member = await createTestUser(app, company.id, 'site_supervisor', 'cc-company');
    const memberSession = await login(member.email);

    const res = await app.inject({
      method:  'PATCH',
      url:     '/api/v1/companies/me',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Renamed Company' },
    });
    expect(res.statusCode).toBe(200);

    expect((await me(memberSession.accessToken)).statusCode).toBe(200);
    expect(await sessionVersion(member.id)).toBe(0);
    expect(await sessionVersion(admin.id)).toBe(0);
  });
});
