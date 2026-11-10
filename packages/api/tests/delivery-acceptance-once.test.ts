/**
 * PATCH /projects/:projectId/sites/:siteId/deliveries/:deliveryId
 *
 * The quantity of a delivery is added to site inventory when the delivery
 * becomes accepted (or partially accepted). Several requests that accept the
 * same delivery at the same time must produce exactly one inventory credit and
 * one delivery_in transaction, and every request still gets the normal 200
 * response. Roles and scoping are unchanged.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  assignUserToProject,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

let admin: TestUser;
let pm: TestUser;
let supervisor: TestUser;
let companyId: string;
let projectId: string;
let siteId: string;

const UNIT = 'bags';
let seq = 0;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'dlv-once');
  companyId = a.company.id;
  admin = a.admin;

  const project = await createTestProject(companyId, 'P1');
  const site = await createTestSite(companyId, project.id, 'S1');
  projectId = project.id;
  siteId = site.id;

  pm = await createTestUser(app, companyId, 'project_manager', 'dlv-once-pm');
  supervisor = await createTestUser(app, companyId, 'site_supervisor', 'dlv-once-sup');
  await assignUserToProject(companyId, projectId, pm.id);
  await assignUserToProject(companyId, projectId, supervisor.id, siteId);

  // Open several pooled connections up front, so the requests of the very
  // first test already run side by side instead of queueing on one connection.
  await Promise.all(Array.from({ length: 8 }, () => prisma.$queryRaw`SELECT 1`));
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

/** A material name no other test in this file uses, so each test owns its stock row. */
function newMaterial(): string {
  seq += 1;
  return `Cement-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A delivery that has arrived; by default it has no acceptance decision yet. */
function makeDelivery(
  material: string,
  quantity = 10,
  acceptanceStatus: 'accepted' | 'partially_accepted' | 'rejected' | null = null,
) {
  return prisma.deliveryRecord.create({
    data: {
      companyId, projectId, siteId,
      supplierName: 'Test Supplier Ltd',
      deliveryDate: new Date('2026-04-01'),
      itemDescription: material,
      unitOfMeasure: UNIT,
      quantityOrdered: quantity,
      quantityDelivered: quantity,
      conditionOnArrival: 'good',
      inspectionStatus: 'pending',
      acceptanceStatus,
      receivedById: admin.id,
    },
  });
}

function patch(user: TestUser, deliveryId: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: body,
  });
}

function create(user: TestUser, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/sites/${siteId}/deliveries`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: body,
  });
}

/** Book stock for a material on the site; 0 when no inventory row exists yet. */
async function stockOf(material: string): Promise<number> {
  const row = await prisma.siteInventory.findUnique({
    where: { siteId_materialName_unitOfMeasure: { siteId, materialName: material, unitOfMeasure: UNIT } },
  });
  return row ? Number(row.currentQuantity) : 0;
}

function creditsFor(deliveryId: string) {
  return prisma.inventoryTransaction.findMany({ where: { deliveryId, type: 'delivery_in' } });
}

// ─── Concurrency ──────────────────────────────────────────────────────────────

describe('concurrent acceptance of one delivery', () => {
  it('eight concurrent accepts credit inventory once', async () => {
    const material = newMaterial();
    const delivery = await makeDelivery(material, 10);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        patch([admin, pm, supervisor][i % 3]!, delivery.id, { acceptanceStatus: 'accepted' })),
    );

    // Accepting is idempotent for the caller: every request sees the accepted delivery.
    expect(results.map((r) => r.statusCode)).toEqual(Array(8).fill(200));
    for (const r of results) expect(r.json().delivery.acceptanceStatus).toBe('accepted');

    expect(await stockOf(material)).toBe(10);
    const credits = await creditsFor(delivery.id);
    expect(credits).toHaveLength(1);
    expect(Number(credits[0]!.quantity)).toBe(10);
  });

  it('concurrent accepted and partially_accepted requests credit inventory once', async () => {
    const material = newMaterial();
    const delivery = await makeDelivery(material, 25);

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        patch(i % 2 ? pm : supervisor, delivery.id, {
          acceptanceStatus: i % 2 ? 'accepted' : 'partially_accepted',
        })),
    );

    expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(200));
    expect(await stockOf(material)).toBe(25);
    expect(await creditsFor(delivery.id)).toHaveLength(1);

    const row = await prisma.deliveryRecord.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(['accepted', 'partially_accepted']).toContain(row.acceptanceStatus);
  });

  it('an accept racing with unrelated edits of the same delivery credits once and keeps the edits', async () => {
    const material = newMaterial();
    const delivery = await makeDelivery(material, 12);

    const results = await Promise.all([
      patch(pm, delivery.id, { acceptanceStatus: 'accepted' }),
      patch(supervisor, delivery.id, { comments: 'gate 2' }),
      patch(admin, delivery.id, { acceptanceStatus: 'accepted', driverName: 'J. Otieno' }),
      patch(supervisor, delivery.id, { vehicleRegistration: 'KDA 123A' }),
    ]);

    expect(results.map((r) => r.statusCode)).toEqual([200, 200, 200, 200]);
    expect(await stockOf(material)).toBe(12);
    expect(await creditsFor(delivery.id)).toHaveLength(1);

    const row = await prisma.deliveryRecord.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(row.acceptanceStatus).toBe('accepted');
    expect(row.comments).toBe('gate 2');
    expect(row.driverName).toBe('J. Otieno');
    expect(row.vehicleRegistration).toBe('KDA 123A');
  });

  it('a rejected delivery accepted by several concurrent requests is credited once', async () => {
    const material = newMaterial();
    const delivery = await makeDelivery(material, 7, 'rejected');

    const results = await Promise.all(
      Array.from({ length: 5 }, () => patch(pm, delivery.id, { acceptanceStatus: 'accepted' })),
    );

    expect(results.map((r) => r.statusCode)).toEqual(Array(5).fill(200));
    expect(await stockOf(material)).toBe(7);
    expect(await creditsFor(delivery.id)).toHaveLength(1);
  });
});

describe('concurrent deliveries of the same material', () => {
  it('different deliveries of a new material accepted at the same time are all credited', async () => {
    const material = newMaterial();
    const deliveries = await Promise.all(Array.from({ length: 6 }, () => makeDelivery(material, 5)));

    const results = await Promise.all(
      deliveries.map((d, i) => patch(i % 2 ? pm : supervisor, d.id, { acceptanceStatus: 'accepted' })),
    );

    expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(200));
    expect(await stockOf(material)).toBe(30);
    for (const d of deliveries) expect(await creditsFor(d.id)).toHaveLength(1);
  });

  it('deliveries of a new material created already accepted at the same time are all credited', async () => {
    const material = newMaterial();

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        create(i % 2 ? pm : supervisor, {
          supplierName: 'Test Supplier Ltd',
          deliveryDate: '2026-04-02',
          itemDescription: material,
          unitOfMeasure: UNIT,
          quantityOrdered: 4,
          quantityDelivered: 4,
          acceptanceStatus: 'accepted',
          receivedById: admin.id,
        })),
    );

    expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(201));
    expect(await stockOf(material)).toBe(24);
    for (const r of results) expect(await creditsFor(r.json().delivery.id)).toHaveLength(1);
  });
});

// ─── Single-request behaviour (unchanged) ─────────────────────────────────────

describe('single requests', () => {
  it('accepting a pending delivery credits inventory and returns the full delivery', async () => {
    const material = newMaterial();
    const delivery = await makeDelivery(material, 10);

    const res = await patch(supervisor, delivery.id, { acceptanceStatus: 'accepted', comments: 'ok' });

    expect(res.statusCode).toBe(200);
    const body = res.json().delivery;
    expect(body).toMatchObject({
      id: delivery.id, companyId, projectId, siteId,
      itemDescription: material,
      acceptanceStatus: 'accepted',
      comments: 'ok',
      receivedById: admin.id,
    });
    expect(body.receivedBy).toMatchObject({ id: admin.id });
    expect(body.photos).toEqual([]);
    expect(body.documents).toEqual([]);

    expect(await stockOf(material)).toBe(10);
    const credits = await creditsFor(delivery.id);
    expect(credits).toHaveLength(1);
    expect(credits[0]!.performedById).toBe(supervisor.id);
  });

  it('accepting an already accepted delivery again does not credit a second time', async () => {
    const material = newMaterial();
    const delivery = await makeDelivery(material, 10);

    expect((await patch(pm, delivery.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    expect((await patch(pm, delivery.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    expect((await patch(pm, delivery.id, { acceptanceStatus: 'partially_accepted' })).statusCode).toBe(200);

    expect(await stockOf(material)).toBe(10);
    expect(await creditsFor(delivery.id)).toHaveLength(1);
  });

  it('rejecting a pending delivery credits nothing', async () => {
    const material = newMaterial();
    const delivery = await makeDelivery(material, 10);

    const res = await patch(pm, delivery.id, { acceptanceStatus: 'rejected', rejectionReason: 'wet bags' });

    expect(res.statusCode).toBe(200);
    expect(res.json().delivery.acceptanceStatus).toBe('rejected');
    expect(await stockOf(material)).toBe(0);
    expect(await creditsFor(delivery.id)).toHaveLength(0);
  });

  it('editing a field without touching acceptance credits nothing', async () => {
    const material = newMaterial();
    const delivery = await makeDelivery(material, 10);

    const res = await patch(pm, delivery.id, { comments: 'left at gate' });

    expect(res.statusCode).toBe(200);
    expect(res.json().delivery.acceptanceStatus).toBeNull();
    expect(await stockOf(material)).toBe(0);
  });

  it('each update writes one audit row with the before and after state', async () => {
    const material = newMaterial();
    const delivery = await makeDelivery(material, 10);

    await patch(pm, delivery.id, { acceptanceStatus: 'accepted' });

    const rows = await prisma.auditLog.findMany({
      where: { entityType: 'delivery_record', entityId: delivery.id, action: 'update' },
    });
    expect(rows).toHaveLength(1);
    expect((rows[0]!.changesBefore as { acceptanceStatus: string | null }).acceptanceStatus).toBeNull();
    expect((rows[0]!.changesAfter as { acceptanceStatus: string | null }).acceptanceStatus).toBe('accepted');
    expect(rows[0]!.userId).toBe(pm.id);
  });

  it('an update of a delivery that does not exist is a 404', async () => {
    const res = await patch(pm, '00000000-0000-4000-8000-000000000000', { acceptanceStatus: 'accepted' });
    expect(res.statusCode).toBe(404);
  });
});
