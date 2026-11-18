/**
 * Mobile push delivery follows account state: a deactivated account's
 * registered devices are not sent notifications; reactivation restores
 * delivery; an active account is unaffected.
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

  it('reactivated account: delivery resumes', async () => {
    const u = await createTestUser(app, cid, 'finance_officer', 'push-back', { canViewFinance: true });
    await registerDevice(u, 'ExponentPushToken[push-back]');
    await setStatus(u, false);
    await setStatus(u, true);
    await notify(u.id);
    expect(sent.join('')).toContain('ExponentPushToken[push-back]');
  });
});
