/**
 * Interim rule for partial acceptance.
 *
 * A delivery cannot yet record how much of it was accepted, and accepting it
 * would credit site stock with the full delivered quantity. Until the accepted
 * quantity can be recorded, a request that would move a delivery with a
 * delivered quantity above zero into partially_accepted (on create or update)
 * is refused with 409 CONFLICT and nothing changes. Accepted, rejected and
 * pending behave as before; deliveries already partially_accepted are left as
 * they are.
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
let foreignAdmin: TestUser;
let companyId: string;
let projectId: string;
let siteId: string;

const UNIT = 'bags';
let seq = 0;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'dlv-pi');
  const b = await createTestCompany(app, 'dlv-pi-b');
  companyId = a.company.id;
  admin = a.admin;
  foreignAdmin = b.admin;

  const project = await createTestProject(companyId, 'P1');
  const site = await createTestSite(companyId, project.id, 'S1');
  projectId = project.id;
  siteId = site.id;

  pm = await createTestUser(app, companyId, 'project_manager', 'dlv-pi-pm');
  supervisor = await createTestUser(app, companyId, 'site_supervisor', 'dlv-pi-sup');
  await assignUserToProject(companyId, projectId, pm.id);
  await assignUserToProject(companyId, projectId, supervisor.id, siteId);

  await Promise.all(Array.from({ length: 8 }, () => prisma.$queryRaw`SELECT 1`));
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

function newMaterial(): string {
  seq += 1;
  return `Gravel-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeDelivery(material: string, quantity = 10) {
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
      receivedById: admin.id,
    },
  });
}

const base = () => `/api/v1/projects/${projectId}/sites/${siteId}/deliveries`;

function create(user: TestUser, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: base(),
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: {
      supplierName: 'Test Supplier Ltd', deliveryDate: '2026-04-02',
      unitOfMeasure: UNIT, quantityOrdered: 10, receivedById: admin.id,
      ...body,
    },
  });
}

function patch(user: TestUser, deliveryId: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `${base()}/${deliveryId}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: body,
  });
}

async function stockOf(material: string): Promise<number> {
  const row = await prisma.siteInventory.findUnique({
    where: { siteId_materialName_unitOfMeasure: { siteId, materialName: material, unitOfMeasure: UNIT } },
  });
  return row ? Number(row.currentQuantity) : 0;
}

function creditsFor(deliveryId: string) {
  return prisma.inventoryTransaction.count({ where: { deliveryId, type: 'delivery_in' } });
}

function audits(id: string) {
  return prisma.auditLog.count({ where: { entityType: 'delivery_record', entityId: id } });
}

function expectRefusal(res: { statusCode: number; json: () => { code: string; error: string } }) {
  expect(res.statusCode).toBe(409);
  expect(res.json().code).toBe('CONFLICT');
  expect(res.json().error).toMatch(/Partial acceptance cannot be recorded yet/);
  expect(res.json().error).toMatch(/full delivered quantity/);
}

// ─── Create ───────────────────────────────────────────────────────────────────

describe('creating a delivery as partially accepted', () => {
  it('is refused when goods were delivered: no delivery, no stock', async () => {
    const material = newMaterial();
    const res = await create(pm, { itemDescription: material, quantityDelivered: 8, acceptanceStatus: 'partially_accepted' });
    expectRefusal(res);
    expect(await prisma.deliveryRecord.count({ where: { itemDescription: material } })).toBe(0);
    expect(await stockOf(material)).toBe(0);
  });

  it('is allowed with a delivered quantity of 0 (nothing to credit)', async () => {
    const material = newMaterial();
    const res = await create(pm, { itemDescription: material, quantityDelivered: 0, acceptanceStatus: 'partially_accepted' });
    expect(res.statusCode).toBe(201);
    expect(await stockOf(material)).toBe(0);
  });

  it('accepted, rejected and pending creates are unchanged', async () => {
    const m1 = newMaterial();
    expect((await create(pm, { itemDescription: m1, quantityDelivered: 7, acceptanceStatus: 'accepted' })).statusCode).toBe(201);
    expect(await stockOf(m1)).toBe(7);
    const m2 = newMaterial();
    expect((await create(pm, { itemDescription: m2, quantityDelivered: 7, acceptanceStatus: 'rejected', rejectionReason: 'x' })).statusCode).toBe(201);
    const m3 = newMaterial();
    expect((await create(supervisor, { itemDescription: m3, quantityDelivered: 7 })).statusCode).toBe(201);
    expect(await stockOf(m2)).toBe(0);
    expect(await stockOf(m3)).toBe(0);
  });
});

// ─── Update ───────────────────────────────────────────────────────────────────

describe('moving a delivery to partially accepted', () => {
  it.each([
    ['pending', null],
    ['rejected', 'rejected'],
  ] as const)('from %s is refused and nothing changes', async (_label, status) => {
    const material = newMaterial();
    const d = await makeDelivery(material, 10);
    if (status) await prisma.deliveryRecord.update({ where: { id: d.id }, data: { acceptanceStatus: status } });
    const auditsBefore = await audits(d.id);

    const res = await patch(supervisor, d.id, { acceptanceStatus: 'partially_accepted', discrepancyNotes: 'short' });

    expectRefusal(res);
    const row = await prisma.deliveryRecord.findUniqueOrThrow({ where: { id: d.id } });
    expect(row.acceptanceStatus).toBe(status);
    expect(row.discrepancyNotes).toBeNull();
    expect(await creditsFor(d.id)).toBe(0);
    expect(await stockOf(material)).toBe(0);
    expect(await audits(d.id)).toBe(auditsBefore);
  });

  it('from accepted (goods in stock) is refused and stock is unchanged', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 10);
    expect((await patch(pm, d.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);

    expectRefusal(await patch(pm, d.id, { acceptanceStatus: 'partially_accepted' }));
    expect((await prisma.deliveryRecord.findUniqueOrThrow({ where: { id: d.id } })).acceptanceStatus).toBe('accepted');
    expect(await stockOf(material)).toBe(10);
    expect(await creditsFor(d.id)).toBe(1);
  });

  it('company admins get the same refusal (no role bypass)', async () => {
    const d = await makeDelivery(newMaterial(), 5);
    expectRefusal(await patch(admin, d.id, { acceptanceStatus: 'partially_accepted' }));
  });

  it('is refused when the same request sets a delivered quantity above zero', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 0);
    expectRefusal(await patch(pm, d.id, { acceptanceStatus: 'partially_accepted', quantityDelivered: 4 }));
    expect(Number((await prisma.deliveryRecord.findUniqueOrThrow({ where: { id: d.id } })).quantityDelivered)).toBe(0);
  });

  it('is allowed when nothing was delivered', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 0);
    expect((await patch(pm, d.id, { acceptanceStatus: 'partially_accepted' })).statusCode).toBe(200);
    expect(await creditsFor(d.id)).toBe(0);
  });

  it('pending -> accepted and pending -> rejected are unchanged', async () => {
    const m1 = newMaterial();
    const d1 = await makeDelivery(m1, 6);
    expect((await patch(supervisor, d1.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    expect(await stockOf(m1)).toBe(6);
    const d2 = await makeDelivery(newMaterial(), 6);
    expect((await patch(supervisor, d2.id, { acceptanceStatus: 'rejected', rejectionReason: 'late' })).statusCode).toBe(200);
  });
});

// ─── Existing partially accepted deliveries ──────────────────────────────────

describe('a delivery that is already partially accepted', () => {
  async function historicalPartial(quantity = 10) {
    // Recorded before this rule: partially accepted and credited in full.
    const material = newMaterial();
    const d = await makeDelivery(material, quantity);
    expect((await patch(pm, d.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    await prisma.deliveryRecord.update({ where: { id: d.id }, data: { acceptanceStatus: 'partially_accepted' } });
    return { id: d.id, material };
  }

  it('can still be edited, with its status re-sent unchanged (web edit form)', async () => {
    const { id, material } = await historicalPartial(10);
    const before = await prisma.deliveryRecord.findUniqueOrThrow({ where: { id } });
    const res = await patch(pm, id, {
      itemDescription: material, unitOfMeasure: UNIT, quantityDelivered: 10,
      acceptanceStatus: 'partially_accepted', comments: 'checked',
    });
    expect(res.statusCode).toBe(200);
    const row = await prisma.deliveryRecord.findUniqueOrThrow({ where: { id } });
    expect(row.acceptanceStatus).toBe('partially_accepted');
    expect(row.quantityDelivered.equals(before.quantityDelivered)).toBe(true);
    expect(await stockOf(material)).toBe(10);
    expect(await creditsFor(id)).toBe(1);
  });

  it('moving it to accepted is unchanged and credits nothing more', async () => {
    const { id, material } = await historicalPartial(9);
    expect((await patch(pm, id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    expect(await stockOf(material)).toBe(9);
    expect(await creditsFor(id)).toBe(1);
  });
});

// ─── Concurrency ──────────────────────────────────────────────────────────────

describe('concurrent accepted and partially accepted requests', () => {
  it('the partial request is always refused; the delivery is accepted and credited once', async () => {
    for (let i = 0; i < 6; i++) {
      const material = newMaterial();
      const d = await makeDelivery(material, 12);
      const [acc, part] = await Promise.all([
        patch(pm, d.id, { acceptanceStatus: 'accepted' }),
        new Promise((r) => setTimeout(r, i)).then(() => patch(supervisor, d.id, { acceptanceStatus: 'partially_accepted' })),
      ]);
      expect(acc.statusCode).toBe(200);
      expect(part.statusCode).toBe(409);
      expect((await prisma.deliveryRecord.findUniqueOrThrow({ where: { id: d.id } })).acceptanceStatus).toBe('accepted');
      expect(await creditsFor(d.id)).toBe(1);
      expect(await stockOf(material)).toBe(12);
    }
  });
});

// ─── Scope unchanged ──────────────────────────────────────────────────────────

describe('scope', () => {
  it('another company\'s admin still gets 404', async () => {
    const d = await makeDelivery(newMaterial(), 3);
    expect((await patch(foreignAdmin, d.id, { acceptanceStatus: 'partially_accepted' })).statusCode).toBe(404);
  });
});
