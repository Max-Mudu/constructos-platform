/**
 * Registered push devices follow the account's sessions: when a password
 * reset or an account setup ends every session of a user, that user's
 * registered devices are removed in the same transaction and are not sent
 * notifications any more. The device is sent notifications again only after a
 * new sign-in registers it. Other users and other companies are unaffected,
 * and the audit row records how many devices were removed (never the tokens).
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { generateToken, hashToken } from '../src/utils/hash';
import { createNotification } from '../src/services/notification.service';
import { sendPushToUser } from '../src/services/push.service';
import * as pushService from '../src/services/push.service';
import { createTestCompany, createTestUser, clearDatabase, TestUser } from './helpers/fixtures';

let app: FastifyInstance;
let cid: string;
let admin: TestUser;
let otherCid: string;

const realFetch = global.fetch;
let sent: string[] = [];

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();
  const a = await createTestCompany(app, 'push-sessions');
  cid = a.company.id;
  admin = a.admin;
  otherCid = (await createTestCompany(app, 'push-sessions-other')).company.id;
});

beforeEach(() => {
  sent = [];
  global.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    sent.push(String(init?.body ?? ''));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

// ─── helpers ────────────────────────────────────────────────────────────────

interface Session { accessToken: string; refreshToken: string }

async function signIn(email: string, password = 'TestPass1'): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return { accessToken: res.json().accessToken, refreshToken: res.json().refreshToken };
}

function registerDevice(accessToken: string, token: string) {
  return app.inject({
    method: 'POST', url: '/api/v1/notifications/push-token',
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { token, platform: 'expo' },
  });
}

async function registerOk(accessToken: string, token: string) {
  expect((await registerDevice(accessToken, token)).statusCode).toBe(204);
}

async function issueResetToken(email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/auth/forgot-password', payload: { email } });
  return (res.json().devLink as string).split('token=')[1]!;
}

function resetWith(token: string, password = 'NewPass123') {
  return app.inject({ method: 'POST', url: '/api/v1/auth/reset-password', payload: { token, password } });
}

async function resetOk(email: string, password = 'NewPass123') {
  expect((await resetWith(await issueResetToken(email), password)).statusCode).toBe(200);
}

async function setStatus(userId: string, isActive: boolean) {
  const res = await app.inject({
    method: 'PATCH', url: `/api/v1/companies/me/users/${userId}/status`,
    headers: { authorization: `Bearer ${admin.accessToken}` },
    payload: { isActive },
  });
  expect(res.statusCode).toBe(200);
}

function notify(companyId: string, userId: string) {
  return createNotification({
    companyId, userId, type: 'invoice_status_changed',
    title: 'Invoice PUSH-2 approved', body: 'Invoice for Vendor has been approved.',
  });
}

function resetAudits(userId: string) {
  return prisma.auditLog.findMany({
    where: { userId, entityType: 'auth', changesAfter: { path: ['event'], equals: 'password_reset_completed' } },
    orderBy: { createdAt: 'asc' },
  });
}

function devices(userId: string) {
  return prisma.pushToken.count({ where: { userId } });
}

/** What a new sign-in issues: an access token carrying the current session version. */
async function currentSessionToken(u: TestUser): Promise<string> {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { sessionVersion: true } });
  return app.jwt.sign({
    sub: u.id, email: u.email, role: u.role, companyId: u.companyId,
    canViewFinance: u.canViewFinance, sv: row.sessionVersion,
  });
}

let seq = 0;
async function newUser(tag: string, companyId = cid): Promise<TestUser> {
  seq += 1;
  return createTestUser(app, companyId, 'finance_officer', `${tag}-${seq}`, { canViewFinance: true });
}

// ─── password reset ─────────────────────────────────────────────────────────

describe('password reset ends sessions and removes registered devices', () => {
  it('removes only that user\'s devices; no push reaches them; others still receive', async () => {
    const u = await newUser('reset');
    const sameCompany = await newUser('reset-neighbour');
    const otherCompany = await newUser('reset-foreign', otherCid);

    const s = await signIn(u.email);
    await registerOk(s.accessToken, 'ExponentPushToken[rs-phone]');
    await registerOk(s.accessToken, 'ExponentPushToken[rs-tablet]');
    await registerOk((await signIn(sameCompany.email)).accessToken, 'ExponentPushToken[rs-neighbour]');
    await registerOk((await signIn(otherCompany.email)).accessToken, 'ExponentPushToken[rs-foreign]');

    await resetOk(u.email);

    expect(await devices(u.id)).toBe(0);
    expect(await devices(sameCompany.id)).toBe(1);
    expect(await devices(otherCompany.id)).toBe(1);

    await notify(cid, u.id);
    await sendPushToUser(u.id, 'direct', 'direct body');
    await notify(cid, sameCompany.id);
    await notify(otherCid, otherCompany.id);
    const all = sent.join('');
    expect(all).not.toContain('ExponentPushToken[rs-phone]');
    expect(all).not.toContain('ExponentPushToken[rs-tablet]');
    expect(all).toContain('ExponentPushToken[rs-neighbour]');
    expect(all).toContain('ExponentPushToken[rs-foreign]');
  });

  it('audits the number of devices removed, never the device tokens', async () => {
    const u = await newUser('reset-audit');
    const s = await signIn(u.email);
    await registerOk(s.accessToken, 'ExponentPushToken[ra-1]');
    await registerOk(s.accessToken, 'ExponentPushToken[ra-2]');

    await resetOk(u.email);

    const logs = await resetAudits(u.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.changesAfter).toEqual({ event: 'password_reset_completed', pushDevicesRemoved: 2 });
    expect(JSON.stringify(logs[0])).not.toContain('ExponentPushToken');
  });

  it('keeps the existing session protections: old access and refresh tokens are refused', async () => {
    const u = await newUser('reset-old');
    const s = await signIn(u.email);
    await registerOk(s.accessToken, 'ExponentPushToken[ro-1]');

    await resetOk(u.email);

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${s.accessToken}` } });
    expect(me.statusCode).toBe(401);
    const refresh = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken: s.refreshToken } });
    expect(refresh.statusCode).toBe(401);
    // The old session cannot put the device back either.
    expect((await registerDevice(s.accessToken, 'ExponentPushToken[ro-1]')).statusCode).toBe(401);
    expect(await devices(u.id)).toBe(0);
  });

  it('after a new sign-in the device registers again and receives pushes', async () => {
    const u = await newUser('reset-relogin');
    const before = await signIn(u.email);
    await registerOk(before.accessToken, 'ExponentPushToken[rr-1]');

    await resetOk(u.email, 'Fresh1234');
    await notify(cid, u.id);
    expect(sent.join('')).not.toContain('ExponentPushToken[rr-1]');

    const after = await signIn(u.email, 'Fresh1234');
    await registerOk(after.accessToken, 'ExponentPushToken[rr-1]');
    await notify(cid, u.id);
    expect(sent.join('')).toContain('ExponentPushToken[rr-1]');
    expect(await devices(u.id)).toBe(1);
  });

  it('a user with no registered device resets normally and the audit records 0', async () => {
    const u = await newUser('reset-none');
    await signIn(u.email);
    await resetOk(u.email);
    const logs = await resetAudits(u.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.changesAfter).toEqual({ event: 'password_reset_completed', pushDevicesRemoved: 0 });
  });
});

// ─── account setup ──────────────────────────────────────────────────────────

describe('account setup through a setup link removes registered devices', () => {
  async function createMember(email: string): Promise<{ id: string; setupToken: string }> {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/companies/me/users',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { email, firstName: 'Set', lastName: 'Up', role: 'finance_officer' },
    });
    expect(res.statusCode).toBe(201);
    return { id: res.json().user.id, setupToken: (res.json().setupLink as string).split('token=')[1]! };
  }

  it('completing setup removes the devices of earlier sessions; a new sign-in registers again', async () => {
    const email = 'setup.member@test.com';
    const m = await createMember(email);
    const member: TestUser = { id: m.id, email, role: 'finance_officer', companyId: cid, canViewFinance: true, accessToken: '' };
    const neighbour = await newUser('setup-neighbour');

    const earlier = await currentSessionToken(member);
    await registerOk(earlier, 'ExponentPushToken[su-1]');
    await registerOk((await signIn(neighbour.email)).accessToken, 'ExponentPushToken[su-neighbour]');

    expect((await resetWith(m.setupToken, 'MyOwnPass1')).statusCode).toBe(200);

    expect(await devices(m.id)).toBe(0);
    expect(await devices(neighbour.id)).toBe(1);
    const logs = await resetAudits(m.id);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.changesAfter).toEqual({ event: 'password_reset_completed', pushDevicesRemoved: 1 });
    expect(JSON.stringify(logs[0])).not.toContain('ExponentPushToken');

    await notify(cid, m.id);
    await notify(cid, neighbour.id);
    expect(sent.join('')).not.toContain('ExponentPushToken[su-1]');
    expect(sent.join('')).toContain('ExponentPushToken[su-neighbour]');
    expect((await registerDevice(earlier, 'ExponentPushToken[su-1]')).statusCode).toBe(401);

    const s = await signIn(email, 'MyOwnPass1');
    await registerOk(s.accessToken, 'ExponentPushToken[su-1]');
    sent = [];
    await notify(cid, m.id);
    expect(sent.join('')).toContain('ExponentPushToken[su-1]');
  });

  it('setup with no registered device audits 0', async () => {
    const m = await createMember('setup.none@test.com');
    expect((await resetWith(m.setupToken, 'MyOwnPass1')).statusCode).toBe(200);
    const logs = await resetAudits(m.id);
    expect(logs[0]!.changesAfter).toEqual({ event: 'password_reset_completed', pushDevicesRemoved: 0 });
  });
});

// ─── concurrency ────────────────────────────────────────────────────────────

describe('concurrent registration and session ending', () => {
  it('a registration authenticated before the reset but written after it leaves no device', async () => {
    const u = await newUser('race-held');
    const s = await signIn(u.email);
    const resetToken = await issueResetToken(u.email);

    const original = pushService.registerPushToken;
    let markEntered!: () => void;
    const entered = new Promise<void>((r) => { markEntered = r; });
    let release!: () => void;
    const released = new Promise<void>((r) => { release = r; });
    jest.spyOn(pushService, 'registerPushToken').mockImplementation(async (...args: Parameters<typeof original>) => {
      markEntered();
      await released;
      return original(...args);
    });

    // The request passes authentication with the old session, then waits.
    const pending = registerDevice(s.accessToken, 'ExponentPushToken[race-held]');
    await entered;
    expect((await resetWith(resetToken)).statusCode).toBe(200);
    release();
    const reg = await pending;

    expect(await devices(u.id)).toBe(0);
    expect(reg.statusCode).toBe(401);
    await notify(cid, u.id);
    expect(sent.join('')).not.toContain('ExponentPushToken[race-held]');
  });

  it('registration racing a reset with the old session never leaves a device (looped)', async () => {
    const u = await newUser('race-loop');
    let password = 'TestPass1';
    for (let i = 0; i < 8; i += 1) {
      const s = await signIn(u.email, password);
      const resetToken = await issueResetToken(u.email);
      const next = `Loop${i}Pass1`;
      const delayMs = i * 60;
      const [reg, reset] = await Promise.all([
        new Promise((r) => setTimeout(r, delayMs)).then(() => registerDevice(s.accessToken, `ExponentPushToken[race-loop-${i}]`)),
        resetWith(resetToken, next),
      ]);
      expect(reset.statusCode).toBe(200);
      expect([204, 401]).toContain(reg.statusCode);
      expect(await devices(u.id)).toBe(0);
      password = next;
    }
  });

  it('two resets at once both succeed; no device is left and the removed count is audited once', async () => {
    const u = await newUser('two-resets');
    const s = await signIn(u.email);
    await registerOk(s.accessToken, 'ExponentPushToken[tr-1]');
    await registerOk(s.accessToken, 'ExponentPushToken[tr-2]');
    const raw = [generateToken(48), generateToken(48)];
    for (const t of raw) {
      await prisma.passwordResetToken.create({
        data: { userId: u.id, tokenHash: hashToken(t), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
    }

    const results = await Promise.all([resetWith(raw[0]!, 'Either111'), resetWith(raw[1]!, 'Either222')]);
    expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(await devices(u.id)).toBe(0);
    const counts = (await resetAudits(u.id)).map((l) => (l.changesAfter as { pushDevicesRemoved: number }).pushDevicesRemoved).sort();
    expect(counts).toEqual([0, 2]);
  });
});

// ─── deactivation / reactivation ────────────────────────────────────────────

describe('compatibility with deactivation and reactivation', () => {
  function lastStatusAudit(userId: string) {
    return prisma.auditLog.findFirst({
      where: { companyId: cid, entityType: 'user', entityId: userId, action: 'update' },
      orderBy: { createdAt: 'desc' },
    });
  }

  it('deactivate, then a reset link is refused, then reactivate: no error and no device', async () => {
    const u = await newUser('deact-reset');
    const s = await signIn(u.email);
    await registerOk(s.accessToken, 'ExponentPushToken[dr-1]');
    const resetToken = await issueResetToken(u.email);

    await setStatus(u.id, false);
    expect((await lastStatusAudit(u.id))?.changesAfter).toMatchObject({ event: 'user_deactivated', pushDevicesRemoved: 1 });
    expect((await resetWith(resetToken)).statusCode).toBe(401);
    await setStatus(u.id, true);

    expect(await devices(u.id)).toBe(0);
    await resetOk(u.email);
    expect((await resetAudits(u.id)).map((l) => l.changesAfter)).toEqual([
      { event: 'password_reset_completed', pushDevicesRemoved: 0 },
    ]);
    await notify(cid, u.id);
    expect(sent.join('')).not.toContain('ExponentPushToken[dr-1]');
  });

  it('reset, then deactivate: deactivation finds nothing left and audits 0', async () => {
    const u = await newUser('reset-deact');
    const s = await signIn(u.email);
    await registerOk(s.accessToken, 'ExponentPushToken[rd-1]');

    await resetOk(u.email);
    await setStatus(u.id, false);

    expect((await resetAudits(u.id))[0]!.changesAfter).toEqual({ event: 'password_reset_completed', pushDevicesRemoved: 1 });
    expect((await lastStatusAudit(u.id))?.changesAfter).toMatchObject({ event: 'user_deactivated', pushDevicesRemoved: 0 });
    expect(await devices(u.id)).toBe(0);
  });
});
