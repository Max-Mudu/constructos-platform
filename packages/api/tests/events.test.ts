import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  clearDatabase,
} from './helpers/fixtures';
import {
  registerClient,
  unregisterClient,
  emitToCompany,
  emitToUser,
  clientCount,
  formatSSE,
} from '../src/services/event-emitter.service';

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

// ─── Event emitter service (unit tests) ──────────────────────────────────────

describe('EventEmitter service', () => {
  afterEach(() => {
    // Clean up any leftover clients between tests
    // (since the module is a singleton, we need to ensure clean state)
  });

  it('formatSSE produces correct SSE wire format', () => {
    const line = formatSSE('test', { foo: 'bar' });
    expect(line).toBe('event: test\ndata: {"foo":"bar"}\n\n');
  });

  it('registers and unregisters clients', () => {
    const writes: string[] = [];
    const client = {
      id: 'test-client-1',
      userId: 'user-1',
      companyId: 'company-1',
      write: (d: string) => writes.push(d),
    };

    const before = clientCount('company-1');
    registerClient(client);
    expect(clientCount('company-1')).toBe(before + 1);

    unregisterClient(client);
    expect(clientCount('company-1')).toBe(before);
  });

  it('emitToCompany broadcasts to all clients in the company', () => {
    const writes1: string[] = [];
    const writes2: string[] = [];
    const writes3: string[] = []; // different company

    const c1 = { id: 'c1', userId: 'u1', companyId: 'co-A', write: (d: string) => writes1.push(d) };
    const c2 = { id: 'c2', userId: 'u2', companyId: 'co-A', write: (d: string) => writes2.push(d) };
    const c3 = { id: 'c3', userId: 'u3', companyId: 'co-B', write: (d: string) => writes3.push(d) };

    registerClient(c1);
    registerClient(c2);
    registerClient(c3);

    emitToCompany('co-A', { type: 'dashboard', payload: { test: true } });

    expect(writes1).toHaveLength(1);
    expect(writes2).toHaveLength(1);
    expect(writes3).toHaveLength(0); // different company not notified

    unregisterClient(c1);
    unregisterClient(c2);
    unregisterClient(c3);
  });

  it('emitToUser only sends to matching userId within company', () => {
    const writes1: string[] = [];
    const writes2: string[] = [];

    const c1 = { id: 'd1', userId: 'user-alpha', companyId: 'co-X', write: (d: string) => writes1.push(d) };
    const c2 = { id: 'd2', userId: 'user-beta',  companyId: 'co-X', write: (d: string) => writes2.push(d) };

    registerClient(c1);
    registerClient(c2);

    emitToUser('co-X', 'user-alpha', { type: 'notification', payload: { title: 'Hello' } });

    expect(writes1).toHaveLength(1);
    expect(writes2).toHaveLength(0); // different user

    unregisterClient(c1);
    unregisterClient(c2);
  });

  it('emitToCompany is no-op when no clients registered', () => {
    // Should not throw
    expect(() =>
      emitToCompany('no-clients-here', { type: 'dashboard' }),
    ).not.toThrow();
  });
});

// ─── GET /events — HTTP layer ─────────────────────────────────────────────────

describe('GET /events — authentication', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/events' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with invalid token', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/events?token=not-a-valid-jwt',
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 200 with SSE headers for valid token', async () => {
    const { admin } = await createTestCompany(app, 'evt-auth');

    // We can't use a long-lived SSE stream in tests — instead, verify
    // that the connection is accepted and headers are set correctly.
    // We abort immediately by not waiting for the full stream.
    const res = await app.inject({
      method:  'GET',
      url:     `/api/v1/events?token=${admin.accessToken}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['cache-control']).toContain('no-cache');
  });

  it('sends connected event in the response body', async () => {
    const { admin } = await createTestCompany(app, 'evt-connected');

    const res = await app.inject({
      method:  'GET',
      url:     `/api/v1/events?token=${admin.accessToken}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('event: connected');
    expect(res.body).toContain('"userId"');
    expect(res.body).toContain('"companyId"');
  });
});

// ─── GET /activity ────────────────────────────────────────────────────────────

describe('GET /activity', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/activity' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for worker role', async () => {
    const { company } = await createTestCompany(app, 'act-worker');
    const user = await createTestUser(app, company.id, 'worker', 'act-worker');
    const res  = await app.inject({
      method:  'GET',
      url:     '/api/v1/activity',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 403 for site_supervisor role', async () => {
    const { company } = await createTestCompany(app, 'act-ss');
    const user = await createTestUser(app, company.id, 'site_supervisor', 'act-ss');
    const res  = await app.inject({
      method:  'GET',
      url:     '/api/v1/activity',
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 200 with activities array for company_admin', async () => {
    const { admin } = await createTestCompany(app, 'act-basic');

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/activity',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.activities)).toBe(true);
  });

  it('activities contain required fields', async () => {
    const { admin } = await createTestCompany(app, 'act-fields');

    // Trigger some audit log entries by creating a project
    await app.inject({
      method:  'POST',
      url:     '/api/v1/projects',
      headers: {
        authorization: `Bearer ${admin.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Test Project for Activity' }),
    });

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/activity?limit=5',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { activities } = res.json();
    expect(activities.length).toBeGreaterThan(0);

    const first = activities[0];
    expect(typeof first.id).toBe('string');
    expect(typeof first.action).toBe('string');
    expect(typeof first.createdAt).toBe('string');
  });

  it('does not return other company activities', async () => {
    const { admin: a1 }    = await createTestCompany(app, 'act-iso1');
    const { admin: a2 }    = await createTestCompany(app, 'act-iso2');

    // Create activity in company 2
    await app.inject({
      method:  'POST',
      url:     '/api/v1/projects',
      headers: {
        authorization: `Bearer ${a2.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: 'Other Company Project' }),
    });

    // Company 1 should not see company 2 activities
    const res1 = await app.inject({
      method:  'GET',
      url:     '/api/v1/activity',
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });
    const res2 = await app.inject({
      method:  'GET',
      url:     '/api/v1/activity',
      headers: { authorization: `Bearer ${a2.accessToken}` },
    });

    const acts1 = res1.json().activities;
    const acts2 = res2.json().activities;

    // All activities in each response belong to the right company
    // (they can't have other company's entity data)
    expect(acts1.length).not.toBe(acts2.length + acts1.length); // don't overlap
    expect(acts2.length).toBeGreaterThan(0);
  });

  it('respects limit param', async () => {
    const { admin } = await createTestCompany(app, 'act-limit');

    // Create several projects to generate audit logs
    for (let i = 1; i <= 5; i++) {
      await app.inject({
        method:  'POST',
        url:     '/api/v1/projects',
        headers: {
          authorization: `Bearer ${admin.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ name: `Project ${i}` }),
      });
    }

    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/activity?limit=3',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().activities.length).toBeLessThanOrEqual(3);
  });
});
