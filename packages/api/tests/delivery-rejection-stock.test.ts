/**
 * PATCH /projects/:projectId/sites/:siteId/deliveries/:deliveryId
 *
 * Once a delivery's goods have been added to site stock (a delivery_in
 * transaction exists for it), the delivery can no longer be moved to rejected,
 * and its delivered quantity, item description and unit can no longer be
 * changed: either would leave site stock disagreeing with the delivery. The
 * request gets 409 CONFLICT, pointing to a stock adjustment, and nothing
 * changes. The check runs under the delivery's row lock, so an accept and a
 * reject sent at the same time can never end as a rejected delivery whose
 * goods are in stock. Roles and scoping are unchanged.
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

  const a = await createTestCompany(app, 'dlv-rej');
  const b = await createTestCompany(app, 'dlv-rej-b');
  companyId = a.company.id;
  admin = a.admin;
  foreignAdmin = b.admin;

  const project = await createTestProject(companyId, 'P1');
  const site = await createTestSite(companyId, project.id, 'S1');
  projectId = project.id;
  siteId = site.id;

  pm = await createTestUser(app, companyId, 'project_manager', 'dlv-rej-pm');
  supervisor = await createTestUser(app, companyId, 'site_supervisor', 'dlv-rej-sup');
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
  return `Sand-${seq}-${Math.random().toString(36).slice(2, 8)}`;
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

function patch(user: TestUser, deliveryId: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/projects/${projectId}/sites/${siteId}/deliveries/${deliveryId}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: body,
  });
}

/** A pending delivery accepted through the API, so its goods are in stock. */
async function acceptedDelivery(quantity = 10, status: 'accepted' | 'partially_accepted' = 'accepted') {
  const material = newMaterial();
  const d = await makeDelivery(material, quantity);
  const res = await patch(pm, d.id, { acceptanceStatus: status });
  expect(res.statusCode).toBe(200);
  return { id: d.id, material };
}

async function stockOf(material: string, unit = UNIT): Promise<number> {
  const row = await prisma.siteInventory.findUnique({
    where: { siteId_materialName_unitOfMeasure: { siteId, materialName: material, unitOfMeasure: unit } },
  });
  return row ? Number(row.currentQuantity) : 0;
}

function creditsFor(deliveryId: string) {
  return prisma.inventoryTransaction.count({ where: { deliveryId, type: 'delivery_in' } });
}

function deliveryRow(id: string) {
  return prisma.deliveryRecord.findUniqueOrThrow({ where: { id } });
}

function updateAudits(id: string) {
  return prisma.auditLog.count({ where: { entityType: 'delivery_record', entityId: id, action: 'update' } });
}

// ─── Rejection after acceptance ───────────────────────────────────────────────

describe('rejecting a delivery whose goods are in stock', () => {
  it.each(['accepted', 'partially_accepted'] as const)(
    'a %s delivery cannot be moved to rejected: 409, delivery and stock unchanged',
    async (status) => {
      const { id, material } = await acceptedDelivery(10, status);
      const auditsBefore = await updateAudits(id);

      const res = await patch(supervisor, id, { acceptanceStatus: 'rejected', rejectionReason: 'wet bags' });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('CONFLICT');
      expect(res.json().error).toMatch(/already been added to site stock/);
      expect(res.json().error).toMatch(/stock adjustment/);
      const row = await deliveryRow(id);
      expect(row.acceptanceStatus).toBe(status);
      expect(row.rejectionReason).toBeNull();
      expect(await stockOf(material)).toBe(10);
      expect(await creditsFor(id)).toBe(1);
      expect(await updateAudits(id)).toBe(auditsBefore);
    },
  );

  it('company admins and project managers get the same 409 (no role bypass)', async () => {
    const { id, material } = await acceptedDelivery(5);
    for (const user of [admin, pm]) {
      const res = await patch(user, id, { acceptanceStatus: 'rejected', rejectionReason: 'x' });
      expect(res.statusCode).toBe(409);
    }
    expect(await stockOf(material)).toBe(5);
  });

  it('a rejection combined with other edits is refused as a whole', async () => {
    const { id } = await acceptedDelivery(5);
    const res = await patch(pm, id, { acceptanceStatus: 'rejected', comments: 'should not be saved' });
    expect(res.statusCode).toBe(409);
    expect((await deliveryRow(id)).comments).toBeNull();
  });

  it('moving between accepted and partially_accepted is still allowed and credits nothing more', async () => {
    const { id, material } = await acceptedDelivery(8);
    expect((await patch(pm, id, { acceptanceStatus: 'partially_accepted' })).statusCode).toBe(200);
    expect((await patch(supervisor, id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    expect(await stockOf(material)).toBe(8);
    expect(await creditsFor(id)).toBe(1);
  });

  it('a pending delivery can still be rejected, and a rejected one accepted later', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 6);
    expect((await patch(supervisor, d.id, { acceptanceStatus: 'rejected', rejectionReason: 'late' })).statusCode).toBe(200);
    expect(await stockOf(material)).toBe(0);
    expect((await patch(supervisor, d.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    expect(await stockOf(material)).toBe(6);
  });

  it('a delivery created with quantity 0 and accepted (nothing credited) can still be rejected', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 0);
    expect((await patch(pm, d.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    expect(await creditsFor(d.id)).toBe(0);
    expect((await patch(pm, d.id, { acceptanceStatus: 'rejected', rejectionReason: 'empty' })).statusCode).toBe(200);
  });
});

// ─── Stock-relevant edits after acceptance ───────────────────────────────────

describe('editing a delivery whose goods are in stock', () => {
  it.each<[string, Record<string, unknown>]>([
    ['quantityDelivered', { quantityDelivered: 7 }],
    ['itemDescription', { itemDescription: 'Different material' }],
    ['unitOfMeasure', { unitOfMeasure: 'tonnes' }],
  ])('changing %s is refused with 409 and nothing changes', async (_field, body) => {
    const { id, material } = await acceptedDelivery(10);
    const res = await patch(pm, id, body);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/stock adjustment/);
    const row = await deliveryRow(id);
    expect(Number(row.quantityDelivered)).toBe(10);
    expect(row.itemDescription).toBe(material);
    expect(row.unitOfMeasure).toBe(UNIT);
    expect(await stockOf(material)).toBe(10);
  });

  it('the web edit form re-sending unchanged values (trimmed) with other edits is accepted', async () => {
    const { id, material } = await acceptedDelivery(10);
    const res = await patch(pm, id, {
      itemDescription: material,
      unitOfMeasure: UNIT,
      quantityDelivered: 10,
      quantityOrdered: 12,
      acceptanceStatus: 'accepted',
      comments: 'checked',
    });
    expect(res.statusCode).toBe(200);
    const row = await deliveryRow(id);
    expect(row.comments).toBe('checked');
    expect(Number(row.quantityOrdered)).toBe(12);
    expect(await stockOf(material)).toBe(10);
    expect(await creditsFor(id)).toBe(1);
  });

  it('a stored value with surrounding spaces matches its trimmed form', async () => {
    const material = newMaterial();
    const d = await prisma.deliveryRecord.update({
      where: { id: (await makeDelivery(material, 4)).id },
      data: { itemDescription: `  ${material} `, unitOfMeasure: ` ${UNIT}` },
    });
    expect((await patch(pm, d.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    expect(await stockOf(material)).toBe(4);
    const res = await patch(pm, d.id, { itemDescription: material, unitOfMeasure: UNIT, comments: 'ok' });
    expect(res.statusCode).toBe(200);
  });

  it('a pending delivery can still be edited freely before acceptance', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 10);
    expect((await patch(supervisor, d.id, { quantityDelivered: 9, unitOfMeasure: 'tonnes' })).statusCode).toBe(200);
    expect((await patch(supervisor, d.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    expect(await stockOf(material, 'tonnes')).toBe(9);
  });
});

// ─── Concurrency ──────────────────────────────────────────────────────────────

describe('concurrent accept and reject of one pending delivery', () => {
  it('never ends as a rejected delivery whose goods are in stock', async () => {
    for (let i = 0; i < 8; i++) {
      const material = newMaterial();
      const d = await makeDelivery(material, 10);

      const [acc, rej] = await Promise.all([
        patch(pm, d.id, { acceptanceStatus: 'accepted' }),
        patch(supervisor, d.id, { acceptanceStatus: 'rejected', rejectionReason: 'race' }),
      ]);
      expect(acc.statusCode).toBe(200);
      expect([200, 409]).toContain(rej.statusCode);

      const row = await deliveryRow(d.id);
      const credits = await creditsFor(d.id);
      const stock = await stockOf(material);
      // Either the rejection came first and the accept then took the goods
      // into stock, or the accept came first and the rejection was refused.
      expect(row.acceptanceStatus).toBe('accepted');
      expect(credits).toBe(1);
      expect(stock).toBe(10);
    }
  });

  it('a quantity edit racing with the accept leaves stock equal to the stored quantity', async () => {
    for (let i = 0; i < 6; i++) {
      const material = newMaterial();
      const d = await makeDelivery(material, 10);

      const [acc, edit] = await Promise.all([
        patch(pm, d.id, { acceptanceStatus: 'accepted' }),
        patch(supervisor, d.id, { quantityDelivered: 4 }),
      ]);
      expect(acc.statusCode).toBe(200);
      expect([200, 409]).toContain(edit.statusCode);

      const row = await deliveryRow(d.id);
      expect(await stockOf(material)).toBe(Number(row.quantityDelivered));
    }
  });
});

// ─── Scope unchanged ──────────────────────────────────────────────────────────

describe('scope', () => {
  it('another company\'s admin still gets 404 and nothing changes', async () => {
    const { id, material } = await acceptedDelivery(3);
    const res = await patch(foreignAdmin, id, { acceptanceStatus: 'rejected' });
    expect(res.statusCode).toBe(404);
    expect((await deliveryRow(id)).acceptanceStatus).toBe('accepted');
    expect(await stockOf(material)).toBe(3);
  });

  it('an unknown delivery is still a 404', async () => {
    const res = await patch(pm, '00000000-0000-4000-8000-000000000000', { acceptanceStatus: 'rejected' });
    expect(res.statusCode).toBe(404);
  });
});
