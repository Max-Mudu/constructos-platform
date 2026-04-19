/**
 * Mobile Backend Tests — Day 16
 *
 * Covers:
 *   1. Auth: refreshToken in login + register response bodies
 *   2. Push tokens: POST /notifications/push-token, DELETE /notifications/push-token/:token
 *   3. Worker self-attendance: POST /projects/:projectId/sites/:siteId/attendance/self
 */

import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  clearDatabase,
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestWorker,
  assignWorkerToSite,
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

// ─── 1. Auth — refreshToken in body ──────────────────────────────────────────

describe('POST /api/v1/auth/register — mobile token', () => {
  it('returns refreshToken in response body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email:       'mobile-owner@acme.com',
        password:    'SecurePass1',
        firstName:   'Alice',
        lastName:    'Smith',
        companyName: 'Acme Mobile',
        currency:    'USD',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(typeof body.refreshToken).toBe('string');
  });
});

describe('POST /api/v1/auth/login — mobile token', () => {
  it('returns refreshToken in response body', async () => {
    const { company: _company } = await createTestCompany(app, 'login-mobile');

    // Register first to create account
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        email:       'login-mobile@acme.com',
        password:    'SecurePass1',
        firstName:   'Bob',
        lastName:    'Mobile',
        companyName: 'Mobile Corp',
        currency:    'USD',
      },
    });
    expect(reg.statusCode).toBe(201);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email:    'login-mobile@acme.com',
        password: 'SecurePass1',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(typeof body.refreshToken).toBe('string');
  });
});

// ─── 2. Push Tokens ───────────────────────────────────────────────────────────

describe('POST /api/v1/notifications/push-token', () => {
  it('registers a push token — 204', async () => {
    const { admin } = await createTestCompany(app, 'push-reg');

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/notifications/push-token',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', platform: 'expo' },
    });

    expect(res.statusCode).toBe(204);

    const stored = await prisma.pushToken.findUnique({
      where: { token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' },
    });
    expect(stored).not.toBeNull();
    expect(stored?.userId).toBe(admin.id);
  });

  it('upserts existing token — idempotent', async () => {
    const { admin } = await createTestCompany(app, 'push-upsert');

    const token = 'ExponentPushToken[upsert-token-123]';
    await app.inject({
      method:  'POST',
      url:     '/api/v1/notifications/push-token',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { token, platform: 'ios' },
    });
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/notifications/push-token',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { token, platform: 'android' },
    });

    expect(res.statusCode).toBe(204);
    const count = await prisma.pushToken.count({ where: { token } });
    expect(count).toBe(1);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/notifications/push-token',
      payload: { token: 'some-token', platform: 'expo' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 422 for missing fields', async () => {
    const { admin } = await createTestCompany(app, 'push-validate');

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/notifications/push-token',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { platform: 'expo' }, // missing token
    });
    expect(res.statusCode).toBe(422);
  });
});

describe('DELETE /api/v1/notifications/push-token/:token', () => {
  it('removes the push token — 204', async () => {
    const { admin } = await createTestCompany(app, 'push-del');
    const token = 'ExponentPushToken[delete-me]';

    await prisma.pushToken.create({
      data: { userId: admin.id, companyId: admin.companyId, token, platform: 'expo' },
    });

    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/v1/notifications/push-token/${encodeURIComponent(token)}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);
    const stored = await prisma.pushToken.findUnique({ where: { token } });
    expect(stored).toBeNull();
  });

  it('is idempotent — deleting non-existent token returns 204', async () => {
    const { admin } = await createTestCompany(app, 'push-del-idem');

    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/v1/notifications/push-token/ExponentPushToken[does-not-exist]`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(res.statusCode).toBe(204);
  });

  it('cannot delete another user\'s token', async () => {
    const { admin }  = await createTestCompany(app, 'push-del-owner-a');
    const { admin: adminB } = await createTestCompany(app, 'push-del-owner-b');
    const token = 'ExponentPushToken[other-user-token]';

    await prisma.pushToken.create({
      data: { userId: admin.id, companyId: admin.companyId, token, platform: 'expo' },
    });

    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/v1/notifications/push-token/${encodeURIComponent(token)}`,
      headers: { authorization: `Bearer ${adminB.accessToken}` },
    });

    expect(res.statusCode).toBe(204); // 204 but did not delete
    const stored = await prisma.pushToken.findUnique({ where: { token } });
    expect(stored).not.toBeNull(); // token still exists
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url:    '/api/v1/notifications/push-token/some-token',
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── 3. Worker Self-Attendance ────────────────────────────────────────────────

describe('POST /api/v1/projects/:projectId/sites/:siteId/attendance/self', () => {
  async function setup() {
    const { company, admin } = await createTestCompany(app, 'self-att');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const worker  = await createTestWorker(company.id);

    // Create a worker-role user and link to the worker record
    const workerUser = await createTestUser(app, company.id, 'worker', 'self-att');
    await prisma.worker.update({
      where: { id: worker.id },
      data:  { userId: workerUser.id },
    });

    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);

    return { company, admin, project, site, worker, workerUser };
  }

  it('worker can submit self-attendance for today — 201', async () => {
    const { project, site, workerUser } = await setup();

    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/projects/${project.id}/sites/${site.id}/attendance/self`,
      headers: { authorization: `Bearer ${workerUser.accessToken}` },
      payload: { checkInTime: '08:00' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.record).toBeDefined();
    expect(body.record.status).toBe('present');
    expect(body.record.checkInTime).toBe('08:00');
  });

  it('self-attendance is idempotent — second submit updates record', async () => {
    const { project, site, workerUser } = await setup();

    await app.inject({
      method:  'POST',
      url:     `/api/v1/projects/${project.id}/sites/${site.id}/attendance/self`,
      headers: { authorization: `Bearer ${workerUser.accessToken}` },
      payload: { checkInTime: '08:00' },
    });

    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/projects/${project.id}/sites/${site.id}/attendance/self`,
      headers: { authorization: `Bearer ${workerUser.accessToken}` },
      payload: { checkInTime: '08:30' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().record.checkInTime).toBe('08:30');

    const count = await prisma.attendanceRecord.count({ where: { companyId: workerUser.companyId } });
    expect(count).toBe(1); // upserted, not doubled
  });

  it('returns 403 for supervisor trying to use self-attendance route', async () => {
    const { company, project, site } = await setup();
    const supervisor = await createTestUser(app, company.id, 'site_supervisor', 'no-self');

    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/projects/${project.id}/sites/${site.id}/attendance/self`,
      headers: { authorization: `Bearer ${supervisor.accessToken}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 403 if worker has no linked worker profile', async () => {
    const { company, project, site } = await setup();
    const unlinkedWorkerUser = await createTestUser(app, company.id, 'worker', 'unlinked');

    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/projects/${project.id}/sites/${site.id}/attendance/self`,
      headers: { authorization: `Bearer ${unlinkedWorkerUser.accessToken}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 403 if worker not assigned to the site', async () => {
    const { company, project, admin } = await setup();
    const otherSite = await createTestSite(company.id, project.id, 'Unassigned Site');

    const unassignedWorker = await createTestWorker(company.id, { firstName: 'Unassigned' });
    const unassignedUser   = await createTestUser(app, company.id, 'worker', 'unassigned');
    await prisma.worker.update({
      where: { id: unassignedWorker.id },
      data:  { userId: unassignedUser.id },
    });
    void admin; // admin used for setup only

    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/projects/${project.id}/sites/${otherSite.id}/attendance/self`,
      headers: { authorization: `Bearer ${unassignedUser.accessToken}` },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const { project, site } = await setup();

    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/projects/${project.id}/sites/${site.id}/attendance/self`,
      payload: {},
    });

    expect(res.statusCode).toBe(401);
  });

  it('rejects invalid checkInTime format', async () => {
    const { project, site, workerUser } = await setup();

    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/projects/${project.id}/sites/${site.id}/attendance/self`,
      headers: { authorization: `Bearer ${workerUser.accessToken}` },
      payload: { checkInTime: '8am' }, // invalid format
    });

    expect(res.statusCode).toBe(422);
  });
});
