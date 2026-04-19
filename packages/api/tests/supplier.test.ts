import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestSupplier,
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

// ─── POST /suppliers ──────────────────────────────────────────────────────────

describe('POST /suppliers', () => {
  it('company_admin can create a supplier', async () => {
    const { admin } = await createTestCompany(app, 'sup-create-1');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        name: 'Acme Materials Ltd',
        contactPerson: 'John Doe',
        email: 'john@acme.com',
        phone: '+254700000000',
        address: 'Nairobi, Kenya',
      },
    });

    expect(res.statusCode).toBe(201);
    const { supplier } = res.json();
    expect(supplier.name).toBe('Acme Materials Ltd');
    expect(supplier.contactPerson).toBe('John Doe');
    expect(supplier.isActive).toBe(true);
  });

  it('project_manager can create a supplier', async () => {
    const { company } = await createTestCompany(app, 'sup-create-2');
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm-sc2');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { name: 'Supplier B' },
    });

    expect(res.statusCode).toBe(201);
  });

  it('finance_officer cannot create a supplier — 403', async () => {
    const { company } = await createTestCompany(app, 'sup-create-3');
    const fo = await createTestUser(app, company.id, 'finance_officer', 'fo-sc3');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${fo.accessToken}` },
      payload: { name: 'X' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated request is rejected — 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/suppliers',
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 422 on missing name', async () => {
    const { admin } = await createTestCompany(app, 'sup-create-4');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { phone: '+254700000000' }, // no name
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('writes audit log on create', async () => {
    const { admin } = await createTestCompany(app, 'sup-create-audit');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Audit Supplier' },
    });

    const supplierId = res.json().supplier.id;
    const log = await prisma.auditLog.findFirst({
      where: { action: 'create', entityType: 'supplier', entityId: supplierId },
    });
    expect(log).toBeTruthy();
  });
});

// ─── GET /suppliers ───────────────────────────────────────────────────────────

describe('GET /suppliers', () => {
  it('lists active suppliers for the company', async () => {
    const { company, admin } = await createTestCompany(app, 'sup-list-1');
    await createTestSupplier(company.id, { name: 'Supplier A' });
    await createTestSupplier(company.id, { name: 'Supplier B' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().suppliers).toHaveLength(2);
  });

  it('does not return inactive suppliers by default', async () => {
    const { company, admin } = await createTestCompany(app, 'sup-list-2');
    const s = await createTestSupplier(company.id);
    await prisma.supplier.update({ where: { id: s.id }, data: { isActive: false } });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.json().suppliers).toHaveLength(0);
  });

  it('returns inactive suppliers with includeInactive=true', async () => {
    const { company, admin } = await createTestCompany(app, 'sup-list-3');
    const s = await createTestSupplier(company.id);
    await prisma.supplier.update({ where: { id: s.id }, data: { isActive: false } });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/suppliers?includeInactive=true',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.json().suppliers).toHaveLength(1);
  });

  it('does not leak suppliers from another company', async () => {
    const { admin: a1 } = await createTestCompany(app, 'sup-list-4a');
    const { company: c2 } = await createTestCompany(app, 'sup-list-4b');
    await createTestSupplier(c2.id, { name: 'C2 Supplier' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.json().suppliers).toHaveLength(0);
  });

  it('finance_officer can view suppliers', async () => {
    const { company } = await createTestCompany(app, 'sup-list-5');
    const fo = await createTestUser(app, company.id, 'finance_officer', 'fo-sl5');
    await createTestSupplier(company.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/suppliers',
      headers: { authorization: `Bearer ${fo.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().suppliers).toHaveLength(1);
  });
});

// ─── GET /suppliers/:supplierId ───────────────────────────────────────────────

describe('GET /suppliers/:supplierId', () => {
  it('returns a supplier by id', async () => {
    const { company, admin } = await createTestCompany(app, 'sup-get-1');
    const s = await createTestSupplier(company.id, { name: 'My Supplier' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/suppliers/${s.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().supplier.name).toBe('My Supplier');
  });

  it('returns 404 for non-existent supplier', async () => {
    const { admin } = await createTestCompany(app, 'sup-get-2');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/suppliers/00000000-0000-0000-0000-000000000000',
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for supplier in another company', async () => {
    const { admin: a1 } = await createTestCompany(app, 'sup-get-3a');
    const { company: c2 } = await createTestCompany(app, 'sup-get-3b');
    const s = await createTestSupplier(c2.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/suppliers/${s.id}`,
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH /suppliers/:supplierId ─────────────────────────────────────────────

describe('PATCH /suppliers/:supplierId', () => {
  it('company_admin can update a supplier', async () => {
    const { company, admin } = await createTestCompany(app, 'sup-update-1');
    const s = await createTestSupplier(company.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/suppliers/${s.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Updated Name', phone: '+254799999999' },
    });

    expect(res.statusCode).toBe(200);
    const { supplier } = res.json();
    expect(supplier.name).toBe('Updated Name');
    expect(supplier.phone).toBe('+254799999999');
  });

  it('finance_officer cannot update — 403', async () => {
    const { company } = await createTestCompany(app, 'sup-update-2');
    const fo = await createTestUser(app, company.id, 'finance_officer', 'fo-su2');
    const s  = await createTestSupplier(company.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/suppliers/${s.id}`,
      headers: { authorization: `Bearer ${fo.accessToken}` },
      payload: { name: 'Fail' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on update', async () => {
    const { company, admin } = await createTestCompany(app, 'sup-update-audit');
    const s = await createTestSupplier(company.id);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/suppliers/${s.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { name: 'Audited Name' },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'update', entityType: 'supplier', entityId: s.id },
    });
    expect(log).toBeTruthy();
  });
});

// ─── DELETE /suppliers/:supplierId ────────────────────────────────────────────

describe('DELETE /suppliers/:supplierId', () => {
  it('company_admin can soft-delete a supplier', async () => {
    const { company, admin } = await createTestCompany(app, 'sup-delete-1');
    const s = await createTestSupplier(company.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/suppliers/${s.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);

    // Supplier should be inactive, not deleted from DB
    const deleted = await prisma.supplier.findUnique({ where: { id: s.id } });
    expect(deleted).toBeTruthy();
    expect(deleted?.isActive).toBe(false);
  });

  it('site_supervisor cannot soft-delete — 403', async () => {
    const { company } = await createTestCompany(app, 'sup-delete-2');
    const sup = await createTestUser(app, company.id, 'site_supervisor', 'sup-sd2');
    const s   = await createTestSupplier(company.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/suppliers/${s.id}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });
});
