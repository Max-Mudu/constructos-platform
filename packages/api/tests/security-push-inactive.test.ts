/**
 * Mobile push delivery follows account state: a deactivated account's
 * registered devices are removed and not sent notifications. Reactivation
 * brings back neither the earlier sessions nor the earlier devices: a device
 * is sent notifications again only after a new sign-in registers it. An
 * active account is unaffected.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import { createNotification } from '../src/services/notification.service';
import { sendPushToUser } from '../src/services/push.service';
import { createTestCompany, createTestUser, clearDatabase, TestUser } from './helpers/fixtures';

let app: FastifyInstance;
let cid: string;
let admin: TestUser;

const realFetch = global.fetch;
let sent: string[] = [];

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();
  const a = await createTestCompany(app, 'push-inactive');
  cid = a.company.id;
  admin = a.admin;
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
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

async function registerDevice(user: TestUser, token: string) {
  const res = await app.inject({
    method: 'POST', url: '/api/v1/notifications/push-token',
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: { token, platform: 'expo' },
  });
  expect(res.statusCode).toBe(204);
}

async function setStatus(user: TestUser, isActive: boolean) {
  const res = await app.inject({
    method: 'PATCH', url: `/api/v1/companies/me/users/${user.id}/status`,
    headers: { authorization: `Bearer ${admin.accessToken}` },
    payload: { isActive },
  });
  expect(res.statusCode).toBe(200);
}

function notify(userId: string) {
  return createNotification({
    companyId: cid, userId, type: 'invoice_status_changed',
    title: 'Invoice PUSH-1 approved', body: 'Invoice for Vendor has been approved.',
  });
}

describe('push delivery and account state', () => {
  it('active account: its device is sent the notification', async () => {
    const u = await createTestUser(app, cid, 'finance_officer', 'push-active', { canViewFinance: true });
    await registerDevice(u, 'ExponentPushToken[push-active]');
    await notify(u.id);
    expect(sent.join('')).toContain('ExponentPushToken[push-active]');
  });

  it('deactivated account: no push is sent to its device', async () => {
    const u = await createTestUser(app, cid, 'finance_officer', 'push-off', { canViewFinance: true });
    await registerDevice(u, 'ExponentPushToken[push-off]');
    await setStatus(u, false);
    await notify(u.id);
    await sendPushToUser(u.id, 'direct', 'direct body');
    expect(sent.join('')).not.toContain('ExponentPushToken[push-off]');
  });

  it('deactivated account: a device row that still exists is not sent to either', async () => {
    const u = await createTestUser(app, cid, 'finance_officer', 'push-row', { canViewFinance: true });
    await setStatus(u, false);
    // A row left behind (e.g. written by a request already in progress).
    await prisma.pushToken.create({
      data: { userId: u.id, companyId: cid, token: 'ExponentPushToken[push-row]', platform: 'expo' },
    });
    await notify(u.id);
    await sendPushToUser(u.id, 'direct', 'direct body');
    expect(sent.join('')).not.toContain('ExponentPushToken[push-row]');
  });

  it('deactivation removes that account\'s devices only, and records how many', async () => {
    const u = await createTestUser(app, cid, 'finance_officer', 'push-gone', { canViewFinance: true });
    const other = await createTestUser(app, cid, 'finance_officer', 'push-stays', { canViewFinance: true });
    await registerDevice(u, 'ExponentPushToken[push-gone-1]');
    await registerDevice(u, 'ExponentPushToken[push-gone-2]');
    await registerDevice(other, 'ExponentPushToken[push-stays]');

    await setStatus(u, false);

    expect(await prisma.pushToken.count({ where: { userId: u.id } })).toBe(0);
    expect(await prisma.pushToken.count({ where: { userId: other.id } })).toBe(1);
    const log = await prisma.auditLog.findFirst({
      where: { companyId: cid, entityType: 'user', entityId: u.id, action: 'update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.changesAfter).toMatchObject({ event: 'user_deactivated', pushDevicesRemoved: 2 });

    await notify(other.id);
    expect(sent.join('')).toContain('ExponentPushToken[push-stays]');
  });

  it('reactivated account: the earlier device is not sent notifications', async () => {
    const u = await createTestUser(app, cid, 'finance_officer', 'push-back', { canViewFinance: true });
    await registerDevice(u, 'ExponentPushToken[push-back]');
    await setStatus(u, false);
    await setStatus(u, true);

    await notify(u.id);
    await sendPushToUser(u.id, 'direct', 'direct body');

    expect(sent.join('')).not.toContain('ExponentPushToken[push-back]');
    expect(await prisma.pushToken.count({ where: { userId: u.id } })).toBe(0);
  });

  it('reactivated account: the earlier session is still refused and cannot register a device', async () => {
    const u = await createTestUser(app, cid, 'finance_officer', 'push-old-session', { canViewFinance: true });
    await registerDevice(u, 'ExponentPushToken[push-old-session]');
    await setStatus(u, false);
    await setStatus(u, true);

    const res = await app.inject({
      method: 'POST', url: '/api/v1/notifications/push-token',
      headers: { authorization: `Bearer ${u.accessToken}` },
      payload: { token: 'ExponentPushToken[push-old-session]', platform: 'expo' },
    });

    expect(res.statusCode).toBe(401);
    expect(await prisma.pushToken.count({ where: { userId: u.id } })).toBe(0);
    await notify(u.id);
    expect(sent.join('')).not.toContain('ExponentPushToken[push-old-session]');
  });

  it('reactivated account: a device registered after a new sign-in is sent notifications', async () => {
    const u = await createTestUser(app, cid, 'finance_officer', 'push-new-session', { canViewFinance: true });
    await registerDevice(u, 'ExponentPushToken[push-before]');
    await setStatus(u, false);
    await setStatus(u, true);

    // What a new sign-in issues: a token carrying the account's current session version.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { sessionVersion: true } });
    const fresh: TestUser = {
      ...u,
      accessToken: app.jwt.sign({
        sub: u.id, email: u.email, role: u.role, companyId: u.companyId,
        canViewFinance: u.canViewFinance, sv: row.sessionVersion,
      }),
    };
    await registerDevice(fresh, 'ExponentPushToken[push-after]');
    await notify(u.id);

    expect(sent.join('')).toContain('ExponentPushToken[push-after]');
    expect(sent.join('')).not.toContain('ExponentPushToken[push-before]');
  });
});
