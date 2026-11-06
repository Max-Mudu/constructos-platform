/**
 * POST /companies/me/users/:id/setup-link — re-issue a one-time setup link.
 *
 * Same token mechanism and semantics as the link minted at creation:
 * password-reset token, 60-minute expiry, single use, previous links consumed,
 * company_admin only, same company, audit-logged, raw link returned only
 * outside production.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { env } from '../src/utils/env';
import { emailService } from '../src/services/email.service';
import { createTestCompany, createTestUser, clearDatabase } from './helpers/fixtures';

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

afterEach(() => jest.restoreAllMocks());

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

function reissue(token: string | null, userId: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/companies/me/users/${userId}/setup-link`,
    ...(token ? { headers: auth(token) } : {}),
    ...(payload ? { payload } : {}),
  });
}

const tokenOf = (link: string) => link.split('token=')[1]!;

function resetWith(token: string, password = 'ChosenPass1!') {
  return app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password } });
}

/** Creates a pending (never signed in) finance officer through the API. */
async function createPending(adminToken: string, email = 'pending@test.com') {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/companies/me/users',
    headers: auth(adminToken),
    payload: { email, firstName: 'Pen', lastName: 'Ding', role: 'finance_officer' },
  });
  expect(res.statusCode).toBe(201);
  return { id: res.json().user.id as string, email, firstLink: res.json().setupLink as string };
}

describe('authorization and tenant boundary', () => {
  it('401 without a token', async () => {
    const { company } = await createTestCompany(app, 'rsl-401');
    const target = await createTestUser(app, company.id, 'viewer', 'rsl-401-t');
    expect((await reissue(null, target.id)).statusCode).toBe(401);
  });

  it('403 for every non company_admin role, and no token is minted', async () => {
    const { company, admin } = await createTestCompany(app, 'rsl-403');
    const pending = await createPending(admin.accessToken);
    for (const role of ['finance_officer', 'project_manager', 'site_supervisor', 'contractor', 'consultant', 'worker', 'viewer'] as const) {
      const actor = await createTestUser(app, company.id, role, `rsl-403-${role}`);
      expect({ role, status: (await reissue(actor.accessToken, pending.id)).statusCode }).toEqual({ role, status: 403 });
    }
    expect(await prisma.passwordResetToken.count({ where: { userId: pending.id } })).toBe(1);
  });

  it('403 when the actor\'s database role is no longer company_admin (stale JWT)', async () => {
    const { company, admin } = await createTestCompany(app, 'rsl-stale');
    const pending = await createPending(admin.accessToken);
    await createTestUser(app, company.id, 'company_admin', 'rsl-stale-keep');
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'viewer' } });
    expect((await reissue(admin.accessToken, pending.id)).statusCode).toBe(403);
  });

  it('404 for a user in another company, a super_admin, an unknown or malformed id', async () => {
    const a = await createTestCompany(app, 'rsl-tenant-a');
    const b = await createTestCompany(app, 'rsl-tenant-b');
    const bPending = await createPending(b.admin.accessToken, 'b-pending@test.com');
    const sa = await createTestUser(app, a.company.id, 'super_admin', 'rsl-sa');

    for (const id of [bPending.id, b.admin.id, sa.id, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      expect({ id, status: (await reissue(a.admin.accessToken, id)).statusCode }).toEqual({ id, status: 404 });
    }
    // B's pending link still works: nothing was invalidated across tenants
    expect((await resetWith(tokenOf(bPending.firstLink))).statusCode).toBe(200);
  });

  it('422 when a body field is supplied', async () => {
    const { admin } = await createTestCompany(app, 'rsl-422');
    const pending = await createPending(admin.accessToken);
    expect((await reissue(admin.accessToken, pending.id, { expiresInMinutes: 99999 })).statusCode).toBe(422);
    expect(await prisma.passwordResetToken.count({ where: { userId: pending.id } })).toBe(1);
  });
});

describe('re-issuing', () => {
  it('returns a new single-use link; the previous one stops working', async () => {
    const { company, admin } = await createTestCompany(app, 'rsl-ok');
    const pending = await createPending(admin.accessToken);

    const before = Date.now();
    const res = await reissue(admin.accessToken, pending.id);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['setupEmailSent', 'setupLink', 'user']);
    expect(Object.keys(body.user).sort()).toEqual(['email', 'firstName', 'id', 'isActive', 'lastName', 'role']);
    expect(body.setupLink).toMatch(/\/reset-password\?token=[A-Za-z0-9_-]+$/);
    expect(body.setupLink).not.toBe(pending.firstLink);
    expect(res.body).not.toMatch(/passwordHash|tokenHash|lastLoginAt/);

    // Exactly one live token, expiring in ~60 minutes
    const live = await prisma.passwordResetToken.findMany({ where: { userId: pending.id, usedAt: null } });
    expect(live).toHaveLength(1);
    const minutes = (live[0]!.expiresAt.getTime() - before) / 60_000;
    expect(minutes).toBeGreaterThan(59);
    expect(minutes).toBeLessThanOrEqual(60.5);
    // Only the hash is stored
    expect(live[0]!.tokenHash).not.toBe(tokenOf(body.setupLink));

    expect((await resetWith(tokenOf(pending.firstLink))).statusCode).toBe(401);
    expect((await resetWith(tokenOf(body.setupLink))).statusCode).toBe(200);
    expect((await resetWith(tokenOf(body.setupLink), 'Another1!x')).statusCode).toBe(401);

    const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: pending.email, password: 'ChosenPass1!' } });
    expect(login.statusCode).toBe(200);

    // Audit row, without the token
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'user', entityId: pending.id, action: 'update' },
    });
    expect(log.userId).toBe(admin.id);
    expect(log.companyId).toBe(company.id);
    expect(log.changesAfter).toEqual({ event: 'setup_link_reissued', setupTokensInvalidated: 1 });
    expect(JSON.stringify(log)).not.toContain(tokenOf(body.setupLink));
  });

  it('a second re-issue invalidates the first re-issued link', async () => {
    const { admin } = await createTestCompany(app, 'rsl-twice');
    const pending = await createPending(admin.accessToken);
    const one = (await reissue(admin.accessToken, pending.id)).json().setupLink as string;
    const two = (await reissue(admin.accessToken, pending.id)).json().setupLink as string;
    expect((await resetWith(tokenOf(one))).statusCode).toBe(401);
    expect((await resetWith(tokenOf(two))).statusCode).toBe(200);
  });

  it('works after deactivate → reactivate (which consumed the original link)', async () => {
    const { admin } = await createTestCompany(app, 'rsl-react');
    const pending = await createPending(admin.accessToken);
    const status = (isActive: boolean) => app.inject({
      method: 'PATCH', url: `/api/v1/companies/me/users/${pending.id}/status`,
      headers: auth(admin.accessToken), payload: { isActive },
    });
    expect((await status(false)).statusCode).toBe(200);

    // While inactive: refused
    const inactive = await reissue(admin.accessToken, pending.id);
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json().error).toMatch(/reactivate/i);

    expect((await status(true)).statusCode).toBe(200);
    expect((await resetWith(tokenOf(pending.firstLink))).statusCode).toBe(401);

    const res = await reissue(admin.accessToken, pending.id);
    expect(res.statusCode).toBe(200);
    expect((await resetWith(tokenOf(res.json().setupLink))).statusCode).toBe(200);
  });

  it('409 once the user has signed in, and for the admin themselves', async () => {
    const { company, admin } = await createTestCompany(app, 'rsl-signed');
    const used = await createTestUser(app, company.id, 'viewer', 'rsl-signed-v');
    await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: used.email, password: 'TestPass1' } });

    const res = await reissue(admin.accessToken, used.id);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/forgot password/i);

    const self = await reissue(admin.accessToken, admin.id);
    expect(self.statusCode).toBe(409);

    expect(await prisma.passwordResetToken.count({ where: { userId: { in: [used.id, admin.id] } } })).toBe(0);
  });

  it('never returns the link in production, and still emails it', async () => {
    const { admin } = await createTestCompany(app, 'rsl-prod');
    const pending = await createPending(admin.accessToken);
    const send = jest.spyOn(emailService, 'sendAccountSetupEmail').mockResolvedValue(true);

    const mutable = env as unknown as { isProduction: boolean };
    const saved = mutable.isProduction;
    mutable.isProduction = true;
    let res;
    try {
      res = await reissue(admin.accessToken, pending.id);
    } finally {
      mutable.isProduction = saved;
    }
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('setupLink');
    expect(res.json().setupEmailSent).toBe(true);
    expect(res.body).not.toContain('token=');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe(pending.email);
    expect(send.mock.calls[0]![1]).toMatch(/\/reset-password\?token=/);
  });

  it('an email failure does not fail the request', async () => {
    const { admin } = await createTestCompany(app, 'rsl-mailfail');
    const pending = await createPending(admin.accessToken);
    jest.spyOn(emailService, 'sendAccountSetupEmail').mockRejectedValue(new Error('smtp down'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await reissue(admin.accessToken, pending.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().setupEmailSent).toBe(false);
  });
});

describe('team list exposes setupPending', () => {
  it('is true until the user first signs in', async () => {
    const { admin } = await createTestCompany(app, 'rsl-list');
    const pending = await createPending(admin.accessToken);
    const find = async () => (await app.inject({
      method: 'GET', url: '/api/v1/companies/me/users', headers: auth(admin.accessToken),
    })).json().users.find((u: { id: string }) => u.id === pending.id);

    expect((await find()).setupPending).toBe(true);
    expect((await resetWith(tokenOf(pending.firstLink))).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email: pending.email, password: 'ChosenPass1!' } });
    expect((await find()).setupPending).toBe(false);
  });
});
