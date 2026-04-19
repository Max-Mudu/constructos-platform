import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
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

describe('GET /api/v1/companies/me', () => {
  it('returns own company for company_admin', async () => {
    const { company, admin } = await createTestCompany(app, 'co-get-1');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/companies/me',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.company.id).toBe(company.id);
    expect(body.company.name).toBe(company.name);
  });

  it('returns own company for project_manager', async () => {
    const { company, admin } = await createTestCompany(app, 'co-get-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-get-2');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/companies/me',
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().company.id).toBe(company.id);
  });

  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/companies/me' });
    expect(res.statusCode).toBe(401);
  });

  it('does not expose password hash or other sensitive fields', async () => {
    const { admin } = await createTestCompany(app, 'co-get-3');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/companies/me',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const body = res.json();
    expect(body.company.passwordHash).toBeUndefined();
    expect(body.company.users).toBeUndefined();
  });
});

describe('PATCH /api/v1/companies/me', () => {
  it('company_admin can update company name and currency', async () => {
    const { company, admin } = await createTestCompany(app, 'co-patch-1');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/companies/me',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Updated Company Name', currency: 'GBP' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.company.name).toBe('Updated Company Name');
    expect(body.company.currency).toBe('GBP');
  });

  it('writes audit log on company update', async () => {
    const { company, admin } = await createTestCompany(app, 'co-patch-audit');

    await app.inject({
      method: 'PATCH',
      url: '/api/v1/companies/me',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Audited Name' },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'update', entityType: 'company', entityId: company.id },
    });
    expect(log).toBeTruthy();
    expect((log!.changesAfter as Record<string, unknown>)['name']).toBe('Audited Name');
  });

  it('project_manager cannot update company — 403', async () => {
    const { company } = await createTestCompany(app, 'co-patch-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-patch-2');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/companies/me',
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { name: 'Should Not Work' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('site_supervisor cannot update company — 403', async () => {
    const { company } = await createTestCompany(app, 'co-patch-3');
    const sup = await createTestUser(app, company.id, 'site_supervisor', 'sup-patch-3');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/companies/me',
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { name: 'Should Not Work' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects invalid currency code with 422', async () => {
    const { admin } = await createTestCompany(app, 'co-patch-4');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/companies/me',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { currency: 'TOOLONG' },
    });

    expect(res.statusCode).toBe(422);
  });

  it('company_admin cannot modify another company', async () => {
    const { admin: admin1 } = await createTestCompany(app, 'co-tenant-1');
    const { company: company2 } = await createTestCompany(app, 'co-tenant-2');

    // admin1 always hits /companies/me which resolves to their own company
    // so they cannot target company2 at all — verify their company is unchanged
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/companies/me',
      headers: { authorization: `Bearer ${admin1.accessToken}` },
      payload: { name: 'Attempt Cross-Tenant Update' },
    });

    const c2 = await prisma.company.findUnique({ where: { id: company2.id } });
    expect(c2!.name).toBe('Test Company co-tenant-2');
  });
});
