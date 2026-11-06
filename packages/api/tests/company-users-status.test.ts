import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  clearDatabase,
  TestUser,
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

function setStatus(token: string | null, userId: string, payload: unknown) {
  return app.inject({
    method: 'PATCH',
    url:    `/api/v1/companies/me/users/${userId}/status`,
    ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
    payload: payload as Record<string, unknown>,
  });
}

/** Logs in with the fixture password and returns the raw refresh token. */
async function loginRefreshToken(email: string): Promise<string> {
  const res = await app.inject({
    method:  'POST',
    url:     '/api/v1/auth/login',
    payload: { email, password: 'TestPass1' },
  });
  expect(res.statusCode).toBe(200);
  const raw = res.headers['set-cookie'];
  const cookie = Array.isArray(raw) ? raw.join(';') : String(raw);
  const token = cookie.split('refreshToken=')[1]?.split(';')[0];
  expect(token).toBeTruthy();
  return token!;
}

function refresh(refreshToken: string) {
  return app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } });
}

async function secondAdmin(companyId: string, suffix: string): Promise<TestUser> {
  return createTestUser(app, companyId, 'company_admin', suffix, { canViewFinance: true });
}

// ─── Authorization & tenant boundary ──────────────────────────────────────────

describe('PATCH /companies/me/users/:id/status — authorization', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const { admin } = await createTestCompany(app, 'cus-401');
    const res = await setStatus(null, admin.id, { isActive: false });
    expect(res.statusCode).toBe(401);
  });

  it('rejects every non company_admin role with 403 and changes nothing', async () => {
    const { company } = await createTestCompany(app, 'cus-403');
    const target = await createTestUser(app, company.id, 'viewer', 'cus-403-target');

    for (const role of ['finance_officer', 'project_manager', 'site_supervisor', 'contractor', 'consultant', 'worker', 'viewer'] as const) {
      const actor = await createTestUser(app, company.id, role, `cus-403-${role}`);
      const res = await setStatus(actor.accessToken, target.id, { isActive: false });
      expect({ role, status: res.statusCode }).toEqual({ role, status: 403 });
    }
    expect((await prisma.user.findUnique({ where: { id: target.id } }))!.isActive).toBe(true);
  });

  it('returns 404 for a user in another company and leaves them untouched', async () => {
    const a = await createTestCompany(app, 'cus-tenant-a');
    const b = await createTestCompany(app, 'cus-tenant-b');
    const bUser = await createTestUser(app, b.company.id, 'site_supervisor', 'cus-tenant-b-sup');
    const bRefresh = await loginRefreshToken(bUser.email);

    for (const id of [bUser.id, b.admin.id]) {
      const res = await setStatus(a.admin.accessToken, id, { isActive: false });
      expect(res.statusCode).toBe(404);
    }
    expect((await prisma.user.findUnique({ where: { id: bUser.id } }))!.isActive).toBe(true);
    expect((await prisma.user.findUnique({ where: { id: b.admin.id } }))!.isActive).toBe(true);
    expect((await refresh(bRefresh)).statusCode).toBe(200);
  });

  it('returns 404 for a super_admin and for a malformed id', async () => {
    const { company, admin } = await createTestCompany(app, 'cus-super');
    const sa = await createTestUser(app, company.id, 'super_admin', 'cus-super-sa');

    expect((await setStatus(admin.accessToken, sa.id, { isActive: false })).statusCode).toBe(404);
    expect((await setStatus(admin.accessToken, 'not-a-uuid', { isActive: false })).statusCode).toBe(404);
    expect((await prisma.user.findUnique({ where: { id: sa.id } }))!.isActive).toBe(true);
  });

  it('rejects an invalid body with 422', async () => {
    const { company, admin } = await createTestCompany(app, 'cus-422');
    const target = await createTestUser(app, company.id, 'viewer', 'cus-422-t');
    for (const body of [{}, { isActive: 'false' }, { isActive: 0 }, { isActive: false, role: 'company_admin' }]) {
      const res = await setStatus(admin.accessToken, target.id, body);
      expect({ body, status: res.statusCode }).toEqual({ body, status: 422 });
    }
    const after = await prisma.user.findUnique({ where: { id: target.id } });
    expect(after!.isActive).toBe(true);
    expect(after!.role).toBe('viewer');
  });

  it('refuses an actor whose database role is no longer company_admin (stale JWT)', async () => {
    const { company, admin } = await createTestCompany(app, 'cus-stale-role');
    const target = await createTestUser(app, company.id, 'viewer', 'cus-stale-t');
    await secondAdmin(company.id, 'cus-stale-keep');
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'viewer' } });

    const res = await setStatus(admin.accessToken, target.id, { isActive: false });
    expect(res.statusCode).toBe(403);
    expect((await prisma.user.findUnique({ where: { id: target.id } }))!.isActive).toBe(true);
  });
});

// ─── Deactivation effects ─────────────────────────────────────────────────────

describe('PATCH /companies/me/users/:id/status — deactivation', () => {
  it('deactivates, revokes every refresh token and invalidates unused setup/reset tokens', async () => {
    const { company, admin } = await createTestCompany(app, 'cus-deact');
    const target = await createTestUser(app, company.id, 'site_supervisor', 'cus-deact-t');
    const bystander = await createTestUser(app, company.id, 'site_supervisor', 'cus-deact-by');

    const r1 = await loginRefreshToken(target.email);
    const r2 = await loginRefreshToken(target.email);
    const bystanderRefresh = await loginRefreshToken(bystander.email);

    const alreadyRevokedAt = new Date('2026-01-01T00:00:00.000Z');
    await prisma.refreshToken.create({
      data: { userId: target.id, tokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 86_400_000), revokedAt: alreadyRevokedAt },
    });
    const usedAt = new Date('2026-01-02T00:00:00.000Z');
    await prisma.passwordResetToken.createMany({
      data: [
        { userId: target.id, tokenHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 3_600_000) },
        { userId: target.id, tokenHash: 'c'.repeat(64), expiresAt: new Date(Date.now() + 3_600_000), usedAt },
        { userId: bystander.id, tokenHash: 'd'.repeat(64), expiresAt: new Date(Date.now() + 3_600_000) },
      ],
    });

    const res = await setStatus(admin.accessToken, target.id, { isActive: false });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      changed: true,
      refreshTokensRevoked: 2,
      setupTokensInvalidated: 1,
      user: { id: target.id, isActive: false },
    });
    expect(Object.keys(res.json().user).sort()).toEqual(['email', 'firstName', 'id', 'isActive', 'lastName', 'role']);

    expect((await prisma.user.findUnique({ where: { id: target.id } }))!.isActive).toBe(false);

    // Every refresh token is revoked; the already-revoked one keeps its timestamp
    const tokens = await prisma.refreshToken.findMany({ where: { userId: target.id } });
    expect(tokens).toHaveLength(3);
    for (const t of tokens) expect(t.revokedAt).not.toBeNull();
    expect(tokens.find((t) => t.tokenHash === 'a'.repeat(64))!.revokedAt).toEqual(alreadyRevokedAt);

    // Refreshing with either live session now fails, and so does logging in
    expect((await refresh(r1)).statusCode).toBe(401);
    expect((await refresh(r2)).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: target.email, password: 'TestPass1' } });
    expect(login.statusCode).toBe(401);

    // Reset tokens: unused ones are consumed; the used one keeps its timestamp
    const resets = await prisma.passwordResetToken.findMany({ where: { userId: target.id } });
    for (const t of resets) expect(t.usedAt).not.toBeNull();
    expect(resets.find((t) => t.tokenHash === 'c'.repeat(64))!.usedAt).toEqual(usedAt);

    // Bystander untouched
    expect((await prisma.user.findUnique({ where: { id: bystander.id } }))!.isActive).toBe(true);
    expect((await prisma.passwordResetToken.findFirst({ where: { userId: bystander.id } }))!.usedAt).toBeNull();
    expect((await refresh(bystanderRefresh)).statusCode).toBe(200);
  });

  it('kills a pending setup link so reactivation cannot revive it', async () => {
    const { admin } = await createTestCompany(app, 'cus-setup');
    const created = await app.inject({
      method:  'POST',
      url:     '/api/v1/companies/me/users',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { email: 'pending@test.com', firstName: 'Pen', lastName: 'Ding', role: 'finance_officer' },
    });
    expect(created.statusCode).toBe(201);
    const userId = created.json().user.id as string;
    const token = (created.json().setupLink as string).split('token=')[1]!;

    expect((await setStatus(admin.accessToken, userId, { isActive: false })).statusCode).toBe(200);
    expect((await setStatus(admin.accessToken, userId, { isActive: true })).statusCode).toBe(200);

    const reset = await app.inject({
      method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password: 'ChosenPass1!' },
    });
    expect(reset.statusCode).toBe(401);
  });

  it('writes one audit row per real change', async () => {
    const { company, admin } = await createTestCompany(app, 'cus-audit');
    const target = await createTestUser(app, company.id, 'viewer', 'cus-audit-t');

    const first = await setStatus(admin.accessToken, target.id, { isActive: false });
    const again = await setStatus(admin.accessToken, target.id, { isActive: false });
    expect(first.json().changed).toBe(true);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ changed: false, user: { isActive: false } });

    const logs = await prisma.auditLog.findMany({ where: { entityType: 'user', entityId: target.id, action: 'update' } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.userId).toBe(admin.id);
    expect(logs[0]!.companyId).toBe(company.id);
    expect(logs[0]!.changesBefore).toEqual({ isActive: true });
    expect(logs[0]!.changesAfter).toMatchObject({ isActive: false, event: 'user_deactivated' });
  });
});

// ─── Admin safety ─────────────────────────────────────────────────────────────

describe('PATCH /companies/me/users/:id/status — admin safety', () => {
  it('refuses to let an admin deactivate themselves (409)', async () => {
    const { company, admin } = await createTestCompany(app, 'cus-self');
    await secondAdmin(company.id, 'cus-self-other');

    const res = await setStatus(admin.accessToken, admin.id, { isActive: false });
    expect(res.statusCode).toBe(409);
    expect((await prisma.user.findUnique({ where: { id: admin.id } }))!.isActive).toBe(true);
  });

  it('lets an admin deactivate a peer admin, after which the peer\'s still-valid JWT cannot act', async () => {
    const { company, admin } = await createTestCompany(app, 'cus-peer');
    const peer = await secondAdmin(company.id, 'cus-peer-b');
    const viewer = await createTestUser(app, company.id, 'viewer', 'cus-peer-v');

    expect((await setStatus(admin.accessToken, peer.id, { isActive: false })).statusCode).toBe(200);

    // The deactivated peer still holds an unexpired access token, but
    // authenticate now rejects tokens of inactive users outright (401) before
    // the route's own active-admin re-check (403) is reached.
    expect((await setStatus(peer.accessToken, admin.id, { isActive: false })).statusCode).toBe(401);
    expect((await setStatus(peer.accessToken, peer.id, { isActive: true })).statusCode).toBe(401);
    expect((await setStatus(peer.accessToken, viewer.id, { isActive: false })).statusCode).toBe(401);

    expect((await prisma.user.findUnique({ where: { id: admin.id } }))!.isActive).toBe(true);
    expect((await prisma.user.findUnique({ where: { id: peer.id } }))!.isActive).toBe(false);
    expect((await prisma.user.findUnique({ where: { id: viewer.id } }))!.isActive).toBe(true);
  });

  it('never leaves the company without an active admin when two admins deactivate each other at once', async () => {
    const { company, admin } = await createTestCompany(app, 'cus-race');
    const peer = await secondAdmin(company.id, 'cus-race-b');

    const [x, y] = await Promise.all([
      setStatus(admin.accessToken, peer.id, { isActive: false }),
      setStatus(peer.accessToken, admin.id, { isActive: false }),
    ]);

    const statuses = [x.statusCode, y.statusCode].sort();
    // The loser is refused either by authenticate (already inactive: 401) or by
    // the in-transaction active-admin check (403), depending on timing.
    expect(statuses[0]).toBe(200);
    expect([401, 403]).toContain(statuses[1]);
    const activeAdmins = await prisma.user.count({ where: { companyId: company.id, role: 'company_admin', isActive: true } });
    expect(activeAdmins).toBe(1);
  });
});

// ─── Reactivation ─────────────────────────────────────────────────────────────

describe('PATCH /companies/me/users/:id/status — reactivation', () => {
  it('reactivates a user, who can then log in again; repeating is a no-op', async () => {
    const { company, admin } = await createTestCompany(app, 'cus-react');
    const target = await createTestUser(app, company.id, 'site_supervisor', 'cus-react-t');

    expect((await setStatus(admin.accessToken, target.id, { isActive: false })).statusCode).toBe(200);
    const on = await setStatus(admin.accessToken, target.id, { isActive: true });
    expect(on.statusCode).toBe(200);
    expect(on.json()).toMatchObject({ changed: true, refreshTokensRevoked: 0, user: { isActive: true } });

    const again = await setStatus(admin.accessToken, target.id, { isActive: true });
    expect(again.json()).toMatchObject({ changed: false, user: { isActive: true } });

    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: target.email, password: 'TestPass1' } });
    expect(login.statusCode).toBe(200);

    const logs = await prisma.auditLog.findMany({ where: { entityType: 'user', entityId: target.id, action: 'update' }, orderBy: { createdAt: 'asc' } });
    expect(logs.map((l) => (l.changesAfter as { event: string }).event)).toEqual(['user_deactivated', 'user_reactivated']);
  });
});

// ─── End to end with authenticate (#13): deactivation takes effect at once ────

describe('PATCH /companies/me/users/:id/status — combined with request authentication', () => {
  it('rejects the deactivated user\'s existing access token on the very next request', async () => {
    const { admin, company } = await createTestCompany(app, 'cus-e2e');
    const member = await createTestUser(app, company.id, 'viewer', 'cus-e2e-member');

    const before = await app.inject({
      method: 'GET', url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${member.accessToken}` },
    });
    expect(before.statusCode).toBe(200);

    const refreshToken = await loginRefreshToken(member.email);
    const off = await setStatus(admin.accessToken, member.id, { isActive: false });
    expect(off.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET', url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${member.accessToken}` },
    });
    expect(after.statusCode).toBe(401);
    expect((await refresh(refreshToken)).statusCode).not.toBe(200);
  });

  it('reactivation allows a fresh login but does not revive revoked refresh tokens', async () => {
    const { admin, company } = await createTestCompany(app, 'cus-e2e2');
    const member = await createTestUser(app, company.id, 'viewer', 'cus-e2e2-member');
    const oldRefresh = await loginRefreshToken(member.email);

    expect((await setStatus(admin.accessToken, member.id, { isActive: false })).statusCode).toBe(200);
    expect((await setStatus(admin.accessToken, member.id, { isActive: true })).statusCode).toBe(200);

    expect((await refresh(oldRefresh)).statusCode).not.toBe(200);
    await loginRefreshToken(member.email); // asserts 200 inside
  });
});
