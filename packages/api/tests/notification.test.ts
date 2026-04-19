import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestNotification,
  clearDatabase,
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

// ─── GET /notifications ────────────────────────────────────────────────────────

describe('GET /notifications', () => {
  it('returns notifications for current user', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-list-1');
    await createTestNotification(company.id, admin.id, { title: 'Notification A' });
    await createTestNotification(company.id, admin.id, { title: 'Notification B' });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/notifications',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().notifications).toHaveLength(2);
    expect(res.json().total).toBe(2);
  });

  it('does not return other users notifications', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-list-2');
    const other = await createTestUser(app, company.id, 'project_manager', 'notif-list-2-pm');
    await createTestNotification(company.id, other.id, { title: 'Other User Notif' });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/notifications',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().notifications).toHaveLength(0);
  });

  it('filters by isRead=false', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-list-3');
    await createTestNotification(company.id, admin.id, { isRead: false });
    await createTestNotification(company.id, admin.id, { isRead: true });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/notifications?isRead=false',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().notifications).toHaveLength(1);
    expect(res.json().notifications[0].isRead).toBe(false);
  });

  it('filters by type', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-list-4');
    await createTestNotification(company.id, admin.id, { type: 'system' });
    await createTestNotification(company.id, admin.id, { type: 'budget_approved' });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/notifications?type=system',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().notifications).toHaveLength(1);
    expect(res.json().notifications[0].type).toBe('system');
  });

  it('requires authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/notifications' });
    expect(res.statusCode).toBe(401);
  });
});

// ─── GET /notifications/count ─────────────────────────────────────────────────

describe('GET /notifications/count', () => {
  it('returns correct unread count', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-count-1');
    await createTestNotification(company.id, admin.id, { isRead: false });
    await createTestNotification(company.id, admin.id, { isRead: false });
    await createTestNotification(company.id, admin.id, { isRead: true });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/notifications/count',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(2);
  });

  it('returns 0 when no unread notifications', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-count-2');
    await createTestNotification(company.id, admin.id, { isRead: true });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/notifications/count',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(0);
  });
});

// ─── POST /notifications/:id/read ────────────────────────────────────────────

describe('POST /notifications/:notificationId/read', () => {
  it('marks a notification as read', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-read-1');
    const notification = await createTestNotification(company.id, admin.id, { isRead: false });

    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/notifications/${notification.id}/read`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().notification.isRead).toBe(true);
    expect(res.json().notification.readAt).not.toBeNull();
  });

  it('is idempotent — marking already-read is safe', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-read-2');
    const notification = await createTestNotification(company.id, admin.id, { isRead: true });

    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/notifications/${notification.id}/read`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().notification.isRead).toBe(true);
  });

  it('returns 404 for another user notification', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-read-3');
    const other = await createTestUser(app, company.id, 'project_manager', 'notif-read-3-pm');
    const notification = await createTestNotification(company.id, other.id);

    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/notifications/${notification.id}/read`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /notifications/read-all ────────────────────────────────────────────

describe('POST /notifications/read-all', () => {
  it('marks all unread as read', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-readall-1');
    await createTestNotification(company.id, admin.id, { isRead: false });
    await createTestNotification(company.id, admin.id, { isRead: false });

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/notifications/read-all',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().count).toBe(2);

    const count = await app.inject({
      method:  'GET',
      url:     '/api/v1/notifications/count',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(count.json().count).toBe(0);
  });
});

// ─── DELETE /notifications/:id ────────────────────────────────────────────────

describe('DELETE /notifications/:notificationId', () => {
  it('deletes own notification', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-del-1');
    const notification = await createTestNotification(company.id, admin.id);

    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/v1/notifications/${notification.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);

    const row = await prisma.notification.findUnique({ where: { id: notification.id } });
    expect(row).toBeNull();
  });

  it('cannot delete another users notification', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-del-2');
    const other = await createTestUser(app, company.id, 'project_manager', 'notif-del-2-pm');
    const notification = await createTestNotification(company.id, other.id);

    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/v1/notifications/${notification.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /notifications/preferences ──────────────────────────────────────────

describe('GET /notifications/preferences', () => {
  it('returns default preferences (all enabled) when none stored', async () => {
    const { admin } = await createTestCompany(app, 'notif-pref-get-1');

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/notifications/preferences',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { preferences } = res.json();
    expect(preferences.length).toBeGreaterThan(0);
    // All should default to enabled
    expect(preferences.every((p: { enabled: boolean }) => p.enabled === true)).toBe(true);
  });
});

// ─── PUT /notifications/preferences ──────────────────────────────────────────

describe('PUT /notifications/preferences', () => {
  it('saves and returns updated preferences', async () => {
    const { admin } = await createTestCompany(app, 'notif-pref-put-1');

    const res = await app.inject({
      method:  'PUT',
      url:     '/api/v1/notifications/preferences',
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body:    JSON.stringify({ preferences: [{ type: 'system', enabled: false }] }),
    });

    expect(res.statusCode).toBe(200);
    const systemPref = res.json().preferences.find((p: { type: string }) => p.type === 'system');
    expect(systemPref.enabled).toBe(false);
  });

  it('validates required fields', async () => {
    const { admin } = await createTestCompany(app, 'notif-pref-put-2');

    const res = await app.inject({
      method:  'PUT',
      url:     '/api/v1/notifications/preferences',
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body:    JSON.stringify({ preferences: [] }),
    });

    expect(res.statusCode).toBe(422);
  });

  it('rejects unknown notification type', async () => {
    const { admin } = await createTestCompany(app, 'notif-pref-put-3');

    const res = await app.inject({
      method:  'PUT',
      url:     '/api/v1/notifications/preferences',
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      body:    JSON.stringify({ preferences: [{ type: 'unknown_type', enabled: false }] }),
    });

    expect(res.statusCode).toBe(403);
  });
});

// ─── Audit logging ────────────────────────────────────────────────────────────

describe('Notification audit logging', () => {
  it('creates audit log when marking notification as read', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-audit-1');
    const notification = await createTestNotification(company.id, admin.id, { isRead: false });

    await app.inject({
      method:  'POST',
      url:     `/api/v1/notifications/${notification.id}/read`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const log = await prisma.auditLog.findFirst({
      where: { companyId: company.id, entityType: 'notification', action: 'update' },
    });
    expect(log).not.toBeNull();
  });

  it('creates audit log on mark-all-read', async () => {
    const { company, admin } = await createTestCompany(app, 'notif-audit-2');
    await createTestNotification(company.id, admin.id, { isRead: false });

    await app.inject({
      method:  'POST',
      url:     '/api/v1/notifications/read-all',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const log = await prisma.auditLog.findFirst({
      where: { companyId: company.id, entityType: 'notification', action: 'update' },
    });
    expect(log).not.toBeNull();
  });
});

// ─── Role restrictions ────────────────────────────────────────────────────────

describe('Role restrictions', () => {
  it('worker can read their own notifications', async () => {
    const { company } = await createTestCompany(app, 'notif-role-1');
    const worker = await createTestUser(app, company.id, 'worker', 'notif-role-1-w');
    await createTestNotification(company.id, worker.id, { title: 'Worker notif' });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/notifications',
      headers: { authorization: `Bearer ${worker.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().notifications).toHaveLength(1);
  });

  it('viewer can read their own notifications', async () => {
    const { company } = await createTestCompany(app, 'notif-role-2');
    const viewer = await createTestUser(app, company.id, 'viewer', 'notif-role-2-v');
    await createTestNotification(company.id, viewer.id);

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/notifications',
      headers: { authorization: `Bearer ${viewer.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().notifications).toHaveLength(1);
  });
});
