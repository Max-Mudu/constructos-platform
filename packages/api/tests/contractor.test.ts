import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestContractor,
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

const BASE = '/api/v1/contractors';

// ─── GET / — list ─────────────────────────────────────────────────────────────

describe('GET /contractors', () => {
  it('company_admin can list all contractors', async () => {
    const { company, admin } = await createTestCompany(app, 'con-list-1');
    await createTestContractor(company.id, 'Contractor A');
    await createTestContractor(company.id, 'Contractor B');

    const res = await app.inject({
      method: 'GET',
      url: BASE,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().contractors).toHaveLength(2);
  });

  it('returns only active contractors when isActive=true', async () => {
    const { company, admin } = await createTestCompany(app, 'con-list-2');
    await createTestContractor(company.id, 'Active Co');
    const inactive = await createTestContractor(company.id, 'Inactive Co');
    await prisma.contractor.update({ where: { id: inactive.id }, data: { isActive: false } });

    const res = await app.inject({
      method: 'GET',
      url: `${BASE}?isActive=true`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().contractors).toHaveLength(1);
    expect(res.json().contractors[0].name).toBe('Active Co');
  });

  it('filters by search term', async () => {
    const { company, admin } = await createTestCompany(app, 'con-list-3');
    await createTestContractor(company.id, 'SteelPro Ltd');
    await createTestContractor(company.id, 'Concrete Works');

    const res = await app.inject({
      method: 'GET',
      url: `${BASE}?search=steel`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().contractors).toHaveLength(1);
    expect(res.json().contractors[0].name).toBe('SteelPro Ltd');
  });

  it('contractor role can only see their own linked record', async () => {
    const { company } = await createTestCompany(app, 'con-list-4');
    const contractorUser = await createTestUser(app, company.id, 'contractor', 'cl4');
    await createTestContractor(company.id, 'Own Company', contractorUser.id);
    await createTestContractor(company.id, 'Other Company');

    const res = await app.inject({
      method: 'GET',
      url: BASE,
      headers: { authorization: `Bearer ${contractorUser.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    // Only sees their own linked record
    expect(res.json().contractors).toHaveLength(1);
    expect(res.json().contractors[0].name).toBe('Own Company');
  });

  it('worker role is forbidden — 403', async () => {
    const { company } = await createTestCompany(app, 'con-list-5');
    const worker = await createTestUser(app, company.id, 'worker', 'wk-cl5');

    const res = await app.inject({
      method: 'GET',
      url: BASE,
      headers: { authorization: `Bearer ${worker.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('does not leak contractors from another company', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'con-list-6a');
    const { company: c2 }            = await createTestCompany(app, 'con-list-6b');
    await createTestContractor(c1.id, 'Company 1 Contractor');
    await createTestContractor(c2.id, 'Company 2 Contractor');

    const res = await app.inject({
      method: 'GET',
      url: BASE,
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.json().contractors).toHaveLength(1);
    expect(res.json().contractors[0].name).toBe('Company 1 Contractor');
  });
});

// ─── POST / — create ──────────────────────────────────────────────────────────

describe('POST /contractors', () => {
  it('company_admin can create a contractor', async () => {
    const { admin } = await createTestCompany(app, 'con-create-1');

    const res = await app.inject({
      method: 'POST',
      url: BASE,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        name:                'BuildRight Civil Works',
        contactPerson:       'John Kamau',
        email:               'john@buildright.co.ke',
        phone:               '+254 700 123 456',
        registrationNumber:  'NCA-2020-001',
        tradeSpecialization: 'Civil & Structural',
      },
    });

    expect(res.statusCode).toBe(201);
    const { contractor } = res.json();
    expect(contractor.name).toBe('BuildRight Civil Works');
    expect(contractor.tradeSpecialization).toBe('Civil & Structural');
    expect(contractor.isActive).toBe(true);
  });

  it('project_manager can create a contractor', async () => {
    const { company } = await createTestCompany(app, 'con-create-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-cc2');

    const res = await app.inject({
      method: 'POST',
      url: BASE,
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { name: 'PM Created Contractor' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().contractor.name).toBe('PM Created Contractor');
  });

  it('site_supervisor cannot create — 403', async () => {
    const { company } = await createTestCompany(app, 'con-create-3');
    const sup = await createTestUser(app, company.id, 'site_supervisor', 'sup-cc3');

    const res = await app.inject({
      method: 'POST',
      url: BASE,
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: { name: 'Unauthorized Contractor' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('name is required — 422 without it', async () => {
    const { admin } = await createTestCompany(app, 'con-create-4');

    const res = await app.inject({
      method: 'POST',
      url: BASE,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { email: 'no-name@test.com' },
    });

    expect(res.statusCode).toBe(422);
  });

  it('audit log is created on contractor creation', async () => {
    const { company, admin } = await createTestCompany(app, 'con-create-5');

    await app.inject({
      method: 'POST',
      url: BASE,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Audit Test Contractor' },
    });

    const log = await prisma.auditLog.findFirst({
      where: { companyId: company.id, action: 'create', entityType: 'contractor' },
    });
    expect(log).not.toBeNull();
    expect(log?.userEmail).toBe(admin.email);
  });
});

// ─── PATCH — update ───────────────────────────────────────────────────────────

describe('PATCH /contractors/:contractorId', () => {
  it('company_admin can update a contractor', async () => {
    const { company, admin } = await createTestCompany(app, 'con-update-1');
    const contractor = await createTestContractor(company.id, 'Old Name');

    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${contractor.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'New Name', tradeSpecialization: 'Electrical' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().contractor.name).toBe('New Name');
    expect(res.json().contractor.tradeSpecialization).toBe('Electrical');
  });

  it('can deactivate a contractor via isActive=false', async () => {
    const { company, admin } = await createTestCompany(app, 'con-update-2');
    const contractor = await createTestContractor(company.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${contractor.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { isActive: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().contractor.isActive).toBe(false);
  });

  it('returns 404 for contractor from another company', async () => {
    const { admin: a1 }       = await createTestCompany(app, 'con-update-3a');
    const { company: c2 }     = await createTestCompany(app, 'con-update-3b');
    const otherContractor = await createTestContractor(c2.id, 'Other Co Contractor');

    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE}/${otherContractor.id}`,
      headers: { authorization: `Bearer ${a1.accessToken}` },
      payload: { name: 'Hijacked' },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── DELETE — soft-delete ─────────────────────────────────────────────────────

describe('DELETE /contractors/:contractorId', () => {
  it('company_admin can soft-delete (deactivate) a contractor', async () => {
    const { company, admin } = await createTestCompany(app, 'con-delete-1');
    const contractor = await createTestContractor(company.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `${BASE}/${contractor.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);

    // Record still exists but isActive=false
    const dbRecord = await prisma.contractor.findUnique({ where: { id: contractor.id } });
    expect(dbRecord?.isActive).toBe(false);
  });

  it('returns 404 for non-existent contractor', async () => {
    const { admin } = await createTestCompany(app, 'con-delete-2');

    const res = await app.inject({
      method: 'DELETE',
      url: `${BASE}/00000000-0000-0000-0000-000000000000`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
