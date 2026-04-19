/**
 * Mobile Phase 3 Backend Tests
 *
 * Covers:
 *   1. GET /api/v1/labour  — company-scoped global list with search + pagination
 *   2. GET /api/v1/deliveries — company-scoped global list with search + pagination
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
  createTestLabourEntry,
  createTestDelivery,
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

// ─── GET /api/v1/labour ───────────────────────────────────────────────────────

describe('GET /api/v1/labour', () => {
  it('returns all company labour entries — 200', async () => {
    const { company, admin } = await createTestCompany(app, 'moblab1');
    const project   = await createTestProject(company.id, 'Project A');
    const site      = await createTestSite(company.id, project.id, 'Site A');
    const worker    = await createTestWorker(company.id, { firstName: 'John', lastName: 'Doe' });
    await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
    await createTestLabourEntry(company.id, project.id, site.id, worker.id, admin.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/labour',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ entries: unknown[]; pagination: { total: number } }>();
    expect(body.entries).toHaveLength(1);
    expect(body.pagination.total).toBe(1);
  });

  it('does not return another company\'s labour — tenant isolation', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'moblab2a');
    const { company: c2, admin: a2 } = await createTestCompany(app, 'moblab2b');
    const p1 = await createTestProject(c1.id); const s1 = await createTestSite(c1.id, p1.id);
    const p2 = await createTestProject(c2.id); const s2 = await createTestSite(c2.id, p2.id);
    const w1 = await createTestWorker(c1.id);  const w2 = await createTestWorker(c2.id);
    await assignWorkerToSite(c1.id, p1.id, s1.id, w1.id, a1.id);
    await assignWorkerToSite(c2.id, p2.id, s2.id, w2.id, a2.id);
    await createTestLabourEntry(c1.id, p1.id, s1.id, w1.id, a1.id);
    await createTestLabourEntry(c2.id, p2.id, s2.id, w2.id, a2.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/labour',
      headers: { Authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ entries: Array<{ companyId: string }> }>();
    expect(body.entries.every((e) => e.companyId === c1.id)).toBe(true);
    expect(body.entries).toHaveLength(1);
  });

  it('filters by projectId', async () => {
    const { company, admin } = await createTestCompany(app, 'moblab3');
    const p1 = await createTestProject(company.id, 'Proj 1');
    const p2 = await createTestProject(company.id, 'Proj 2');
    const s1 = await createTestSite(company.id, p1.id);
    const s2 = await createTestSite(company.id, p2.id);
    const w  = await createTestWorker(company.id);
    await assignWorkerToSite(company.id, p1.id, s1.id, w.id, admin.id);
    await assignWorkerToSite(company.id, p2.id, s2.id, w.id, admin.id);
    await createTestLabourEntry(company.id, p1.id, s1.id, w.id, admin.id, { date: new Date('2026-04-01') });
    await createTestLabourEntry(company.id, p2.id, s2.id, w.id, admin.id, { date: new Date('2026-04-02') });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/labour?projectId=${p1.id}`,
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ entries: Array<{ projectId: string }> }>();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.projectId).toBe(p1.id);
  });

  it('searches by worker name', async () => {
    const { company, admin } = await createTestCompany(app, 'moblab4');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const w1 = await createTestWorker(company.id, { firstName: 'Alice', lastName: 'Anderson' });
    const w2 = await createTestWorker(company.id, { firstName: 'Bob',   lastName: 'Brown'    });
    await assignWorkerToSite(company.id, project.id, site.id, w1.id, admin.id);
    await assignWorkerToSite(company.id, project.id, site.id, w2.id, admin.id);
    await createTestLabourEntry(company.id, project.id, site.id, w1.id, admin.id, { date: new Date('2026-04-01') });
    await createTestLabourEntry(company.id, project.id, site.id, w2.id, admin.id, { date: new Date('2026-04-02') });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/labour?search=Alice',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ entries: Array<{ worker: { firstName: string } }> }>();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.worker.firstName).toBe('Alice');
  });

  it('paginates results', async () => {
    const { company, admin } = await createTestCompany(app, 'moblab5');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    // Create 3 workers, 3 entries
    for (let i = 0; i < 3; i++) {
      const w = await createTestWorker(company.id, { firstName: `Worker${i}`, lastName: 'Test' });
      await assignWorkerToSite(company.id, project.id, site.id, w.id, admin.id);
      await createTestLabourEntry(company.id, project.id, site.id, w.id, admin.id, {
        date: new Date(`2026-04-0${i + 1}`),
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/labour?limit=2&offset=0',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ entries: unknown[]; pagination: { total: number; hasMore: boolean } }>();
    expect(body.entries).toHaveLength(2);
    expect(body.pagination.total).toBe(3);
    expect(body.pagination.hasMore).toBe(true);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/labour' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for worker role', async () => {
    const { company } = await createTestCompany(app, 'moblab6');
    const worker = await createTestUser(app, company.id, 'worker', 'moblab6');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/labour',
      headers: { Authorization: `Bearer ${worker.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── GET /api/v1/deliveries ───────────────────────────────────────────────────

describe('GET /api/v1/deliveries', () => {
  it('returns all company delivery records — 200', async () => {
    const { company, admin } = await createTestCompany(app, 'mobd1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await createTestDelivery(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/deliveries',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ records: unknown[]; pagination: { total: number } }>();
    expect(body.records).toHaveLength(1);
    expect(body.pagination.total).toBe(1);
  });

  it('does not return another company\'s deliveries — tenant isolation', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'mobd2a');
    const { company: c2, admin: a2 } = await createTestCompany(app, 'mobd2b');
    const p1 = await createTestProject(c1.id); const s1 = await createTestSite(c1.id, p1.id);
    const p2 = await createTestProject(c2.id); const s2 = await createTestSite(c2.id, p2.id);
    await createTestDelivery(c1.id, p1.id, s1.id, a1.id, { supplierName: 'SupplierA' });
    await createTestDelivery(c2.id, p2.id, s2.id, a2.id, { supplierName: 'SupplierB' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/deliveries',
      headers: { Authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ records: Array<{ companyId: string }> }>();
    expect(body.records.every((r) => r.companyId === c1.id)).toBe(true);
    expect(body.records).toHaveLength(1);
  });

  it('searches by supplier name', async () => {
    const { company, admin } = await createTestCompany(app, 'mobd3');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await createTestDelivery(company.id, project.id, site.id, admin.id, { supplierName: 'Acme Building Supplies' });
    await createTestDelivery(company.id, project.id, site.id, admin.id, { supplierName: 'Premier Cement Ltd' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/deliveries?search=Acme',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ records: Array<{ supplierName: string }> }>();
    expect(body.records).toHaveLength(1);
    expect(body.records[0]!.supplierName).toBe('Acme Building Supplies');
  });

  it('paginates results', async () => {
    const { company, admin } = await createTestCompany(app, 'mobd4');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    for (let i = 0; i < 4; i++) {
      await createTestDelivery(company.id, project.id, site.id, admin.id, {
        supplierName: `Supplier ${i}`,
        deliveryDate: new Date(`2026-04-0${i + 1}`),
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/deliveries?limit=2&offset=2',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ records: unknown[]; pagination: { total: number; hasMore: boolean; offset: number } }>();
    expect(body.records).toHaveLength(2);
    expect(body.pagination.total).toBe(4);
    expect(body.pagination.offset).toBe(2);
    expect(body.pagination.hasMore).toBe(false);
  });

  it('filters by acceptanceStatus', async () => {
    const { company, admin } = await createTestCompany(app, 'mobd5');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await createTestDelivery(company.id, project.id, site.id, admin.id, { supplierName: 'Good Supplier' });
    // Create a rejected delivery directly
    await prisma.deliveryRecord.create({
      data: {
        companyId: company.id, projectId: project.id, siteId: site.id,
        supplierName: 'Bad Supplier', deliveryDate: new Date('2026-04-05'),
        itemDescription: 'Damaged goods', unitOfMeasure: 'pcs',
        quantityOrdered: 10, quantityDelivered: 10,
        conditionOnArrival: 'damaged', acceptanceStatus: 'rejected',
        receivedById: admin.id,
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/deliveries?acceptanceStatus=rejected',
      headers: { Authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ records: Array<{ acceptanceStatus: string }> }>();
    expect(body.records).toHaveLength(1);
    expect(body.records[0]!.acceptanceStatus).toBe('rejected');
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/deliveries' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for worker role', async () => {
    const { company } = await createTestCompany(app, 'mobd6');
    const worker = await createTestUser(app, company.id, 'worker', 'mobd6');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/deliveries',
      headers: { Authorization: `Bearer ${worker.accessToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
