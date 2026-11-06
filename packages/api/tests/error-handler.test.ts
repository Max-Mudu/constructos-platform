/**
 * Global error handler: it must be registered before the route plugins so
 * every route inherits it. Unexpected errors return a generic 500 body and
 * never echo the internal message; 4xx framework errors keep a useful code.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import * as projectService from '../src/services/project.service';
import { clearDatabase, createTestCompany } from './helpers/fixtures';

const SECRET = 'SECRET-internal-detail: relation "projects" at db-host:5432';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  // A plugin registered after buildApp — the same position as every route plugin.
  await app.register(async (plugin) => {
    plugin.get('/__test/boom', async () => { throw new Error(SECRET); });
  });
  await app.ready();
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
  jest.restoreAllMocks();
});

describe('global error handler', () => {
  it('returns a generic 500 from an existing route plugin and never echoes the internal message', async () => {
    const { admin } = await createTestCompany(app, 'errh');
    jest.spyOn(projectService, 'listProjects').mockRejectedValue(new Error(SECRET));

    const res = await app.inject({ method: 'GET', url: '/api/v1/projects', headers: { authorization: `Bearer ${admin.accessToken}` } });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    expect(res.body).not.toContain('SECRET');
    expect(res.body).not.toContain('db-host');
  });

  it('applies to plugins registered after the handler was set', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    expect(res.body).not.toContain('SECRET');
  });

  it('keeps 4xx framework errors as client errors with their own code, not INTERNAL_ERROR', async () => {
    const { admin } = await createTestCompany(app, 'errh-4xx');
    const res = await app.inject({
      method: 'POST', url: '/api/v1/projects',
      headers: { authorization: `Bearer ${admin.accessToken}`, 'content-type': 'application/json' },
      payload: '{"name": ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).not.toBe('INTERNAL_ERROR');
    expect(typeof res.json().code).toBe('string');
  });
});
