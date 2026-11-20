/**
 * Partially accepted deliveries record the accepted quantity.
 *
 * A partially accepted delivery of goods carries quantityAccepted, more than 0
 * and less than the delivered quantity, stored separately from it. Site stock
 * is credited with exactly the accepted quantity, once, in the same
 * transaction as the acceptance and its audit row. Full acceptance credits
 * the delivered quantity as before. Invalid accepted quantities are refused
 * (422). Once credited, the accepted quantity cannot change and the delivery
 * cannot be switched between accepted and partially accepted (409): stock is
 * never adjusted implicitly. Deliveries recorded before the accepted quantity
 * existed keep NULL ("accepted quantity not recorded") and their stock.
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
let finance: TestUser;
let foreignAdmin: TestUser;
let companyId: string;
let projectId: string;
let siteId: string;
let otherSiteId: string;

const UNIT = 'bags';
let seq = 0;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'dlv-pa');
  const b = await createTestCompany(app, 'dlv-pa-b');
  companyId = a.company.id;
  admin = a.admin;
  foreignAdmin = b.admin;

  const project = await createTestProject(companyId, 'P1');
  const site = await createTestSite(companyId, project.id, 'S1');
  const otherSite = await createTestSite(companyId, project.id, 'S2');
  projectId = project.id;
  siteId = site.id;
  otherSiteId = otherSite.id;

  pm = await createTestUser(app, companyId, 'project_manager', 'dlv-pa-pm');
  supervisor = await createTestUser(app, companyId, 'site_supervisor', 'dlv-pa-sup');
  finance = await createTestUser(app, companyId, 'finance_officer', 'dlv-pa-fin');
  await assignUserToProject(companyId, projectId, pm.id);
  await assignUserToProject(companyId, projectId, supervisor.id, siteId);
  await assignUserToProject(companyId, projectId, finance.id);

  await Promise.all(Array.from({ length: 8 }, () => prisma.$queryRaw`SELECT 1`));
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

function newMaterial(): string {
  seq += 1;
  return `Ballast-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeDelivery(material: string, quantity = 10, site = siteId) {
  return prisma.deliveryRecord.create({
    data: {
      companyId, projectId, siteId: site,
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

const base = (site = siteId) => `/api/v1/projects/${projectId}/sites/${site}/deliveries`;

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

function patch(user: TestUser, deliveryId: string, body: Record<string, unknown>, site = siteId) {
  return app.inject({
    method: 'PATCH',
    url: `${base(site)}/${deliveryId}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: body,
  });
}

async function stockOf(material: string, site = siteId): Promise<number> {
  const row = await prisma.siteInventory.findUnique({
    where: { siteId_materialName_unitOfMeasure: { siteId: site, materialName: material, unitOfMeasure: UNIT } },
  });
  return row ? Number(row.currentQuantity) : 0;
}

async function creditsFor(deliveryId: string) {
  const rows = await prisma.inventoryTransaction.findMany({ where: { deliveryId, type: 'delivery_in' } });
  return rows.map((r) => Number(r.quantity));
}

function row(id: string) {
  return prisma.deliveryRecord.findUniqueOrThrow({ where: { id } });
}

function auditCount(id: string) {
  return prisma.auditLog.count({ where: { entityType: 'delivery_record', entityId: id } });
}

// Audit rows hold the delivery as JSON; compare quantities as numbers.
const accepted = (v: unknown) => {
  const q = (v as { quantityAccepted: string | number | null }).quantityAccepted;
  return q === null ? null : Number(q);
};

// ─── Create ───────────────────────────────────────────────────────────────────

describe('creating a delivery', () => {
  it('fully accepted: credits the delivered quantity, no accepted quantity stored', async () => {
    const material = newMaterial();
    const res = await create(pm, { itemDescription: material, quantityDelivered: 9, acceptanceStatus: 'accepted' });
    expect(res.statusCode).toBe(201);
    expect(res.json().delivery.quantityAccepted).toBeNull();
    expect(await stockOf(material)).toBe(9);
    expect(await creditsFor(res.json().delivery.id)).toEqual([9]);
  });

  it('partially accepted: stores both quantities and credits only the accepted one, audited', async () => {
    const material = newMaterial();
    const res = await create(supervisor, {
      itemDescription: material, quantityDelivered: 10, quantityAccepted: 6.5,
      acceptanceStatus: 'partially_accepted', discrepancyNotes: '3.5 bags torn',
    });
    expect(res.statusCode).toBe(201);
    const d = res.json().delivery;
    expect(d.quantityDelivered).toBe('10');
    expect(d.quantityAccepted).toBe('6.5');
    expect(await stockOf(material)).toBe(6.5);
    expect(await creditsFor(d.id)).toEqual([6.5]);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'delivery_record', entityId: d.id, action: 'create' },
    });
    expect(accepted(audit.changesAfter)).toBe(6.5);
  });

  it.each<[string, Record<string, unknown>, number]>([
    ['missing accepted quantity', { acceptanceStatus: 'partially_accepted' }, 422],
    ['accepted quantity equal to delivered', { acceptanceStatus: 'partially_accepted', quantityAccepted: 10 }, 422],
    ['accepted quantity above delivered', { acceptanceStatus: 'partially_accepted', quantityAccepted: 11 }, 422],
    ['accepted quantity 0', { acceptanceStatus: 'partially_accepted', quantityAccepted: 0 }, 422],
    ['negative accepted quantity', { acceptanceStatus: 'partially_accepted', quantityAccepted: -2 }, 422],
    ['more than 3 decimal places', { acceptanceStatus: 'partially_accepted', quantityAccepted: 1.2345 }, 422],
    ['non-numeric accepted quantity', { acceptanceStatus: 'partially_accepted', quantityAccepted: 'five' }, 422],
    ['accepted quantity on a fully accepted delivery', { acceptanceStatus: 'accepted', quantityAccepted: 4 }, 422],
    ['accepted quantity on a pending delivery', { quantityAccepted: 4 }, 422],
    ['accepted quantity on a rejected delivery', { acceptanceStatus: 'rejected', rejectionReason: 'x', quantityAccepted: 4 }, 422],
  ])('%s is refused, nothing created or credited', async (_label, body, status) => {
    const material = newMaterial();
    const res = await create(pm, { itemDescription: material, quantityDelivered: 10, ...body });
    expect(res.statusCode).toBe(status);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(await prisma.deliveryRecord.count({ where: { itemDescription: material } })).toBe(0);
    expect(await stockOf(material)).toBe(0);
  });

  it('partially accepted with nothing delivered needs no accepted quantity and credits nothing', async () => {
    const material = newMaterial();
    const res = await create(pm, { itemDescription: material, quantityDelivered: 0, acceptanceStatus: 'partially_accepted' });
    expect(res.statusCode).toBe(201);
    expect(await stockOf(material)).toBe(0);
  });
});

// ─── Update ───────────────────────────────────────────────────────────────────

describe('partially accepting a pending delivery', () => {
  it('credits exactly the accepted quantity, once, with an audit row holding both states', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 10);

    const res = await patch(supervisor, d.id, { acceptanceStatus: 'partially_accepted', quantityAccepted: 3 });

    expect(res.statusCode).toBe(200);
    expect(res.json().delivery.quantityAccepted).toBe('3');
    expect(res.json().delivery.quantityDelivered).toBe('10');
    expect(await stockOf(material)).toBe(3);
    expect(await creditsFor(d.id)).toEqual([3]);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'delivery_record', entityId: d.id, action: 'update' },
    });
    expect(accepted(audit.changesBefore)).toBeNull();
    expect(accepted(audit.changesAfter)).toBe(3);
  });

  it.each<[string, Record<string, unknown>]>([
    ['without an accepted quantity', { acceptanceStatus: 'partially_accepted' }],
    ['with a null accepted quantity', { acceptanceStatus: 'partially_accepted', quantityAccepted: null }],
    ['with all of the delivered quantity', { acceptanceStatus: 'partially_accepted', quantityAccepted: 10 }],
    ['with more than delivered', { acceptanceStatus: 'partially_accepted', quantityAccepted: 25 }],
    ['with a negative quantity', { acceptanceStatus: 'partially_accepted', quantityAccepted: -1 }],
    ['an accepted quantity with full acceptance', { acceptanceStatus: 'accepted', quantityAccepted: 5 }],
    ['an accepted quantity without a status', { quantityAccepted: 5 }],
  ])('%s is refused with 422 and nothing changes', async (_label, body) => {
    const material = newMaterial();
    const d = await makeDelivery(material, 10);
    const audits = await auditCount(d.id);

    const res = await patch(pm, d.id, { ...body, comments: 'should not be saved' });

    expect(res.statusCode).toBe(422);
    const r = await row(d.id);
    expect(r.acceptanceStatus).toBeNull();
    expect(r.quantityAccepted).toBeNull();
    expect(r.comments).toBeNull();
    expect(await stockOf(material)).toBe(0);
    expect(await auditCount(d.id)).toBe(audits);
  });

  it('the accepted quantity is checked against a delivered quantity changed in the same request', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 10);
    expect((await patch(pm, d.id, { quantityDelivered: 8, acceptanceStatus: 'partially_accepted', quantityAccepted: 9 })).statusCode).toBe(422);
    expect((await patch(pm, d.id, { quantityDelivered: 8, acceptanceStatus: 'partially_accepted', quantityAccepted: 7 })).statusCode).toBe(200);
    expect(await stockOf(material)).toBe(7);
    const r = await row(d.id);
    expect(Number(r.quantityDelivered)).toBe(8);
    expect(Number(r.quantityAccepted)).toBe(7);
  });

  it('a rejected delivery can later be partially accepted', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 10);
    expect((await patch(pm, d.id, { acceptanceStatus: 'rejected', rejectionReason: 'late' })).statusCode).toBe(200);
    expect((await patch(pm, d.id, { acceptanceStatus: 'partially_accepted', quantityAccepted: 4 })).statusCode).toBe(200);
    expect(await creditsFor(d.id)).toEqual([4]);
  });

  it('full acceptance is unchanged: delivered quantity credited, repeats credit nothing more', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 10);
    expect((await patch(pm, d.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    expect((await patch(pm, d.id, { acceptanceStatus: 'accepted', quantityAccepted: null })).statusCode).toBe(200);
    expect(await creditsFor(d.id)).toEqual([10]);
    expect(await stockOf(material)).toBe(10);
  });
});

// ─── After the credit ────────────────────────────────────────────────────────

describe('a partially accepted delivery whose goods are in stock', () => {
  async function partial(delivered = 10, acceptedQty = 4) {
    const material = newMaterial();
    const d = await makeDelivery(material, delivered);
    const res = await patch(pm, d.id, { acceptanceStatus: 'partially_accepted', quantityAccepted: acceptedQty });
    expect(res.statusCode).toBe(200);
    return { id: d.id, material };
  }

  it('a repeated identical request (and the web form re-sending every field) credits nothing more', async () => {
    const { id, material } = await partial(10, 4);
    expect((await patch(supervisor, id, { acceptanceStatus: 'partially_accepted', quantityAccepted: 4 })).statusCode).toBe(200);
    const res = await patch(pm, id, {
      itemDescription: material, unitOfMeasure: UNIT, quantityDelivered: 10, quantityAccepted: 4,
      acceptanceStatus: 'partially_accepted', comments: 'checked',
    });
    expect(res.statusCode).toBe(200);
    expect((await row(id)).comments).toBe('checked');
    expect(await creditsFor(id)).toEqual([4]);
    expect(await stockOf(material)).toBe(4);
  });

  it.each<[string, Record<string, unknown>]>([
    ['changing the accepted quantity', { quantityAccepted: 6 }],
    ['clearing the accepted quantity', { quantityAccepted: null }],
    ['changing the delivered quantity', { quantityDelivered: 12 }],
    ['moving it to fully accepted', { acceptanceStatus: 'accepted' }],
    ['moving it to fully accepted with the remainder', { acceptanceStatus: 'accepted', quantityAccepted: null }],
    ['rejecting it', { acceptanceStatus: 'rejected', rejectionReason: 'x' }],
  ])('%s is refused with 409; delivery and stock unchanged', async (_label, body) => {
    const { id, material } = await partial(10, 4);
    const audits = await auditCount(id);

    const res = await patch(pm, id, body);

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');
    expect(res.json().error).toMatch(/stock adjustment/);
    const r = await row(id);
    expect(r.acceptanceStatus).toBe('partially_accepted');
    expect(Number(r.quantityAccepted)).toBe(4);
    expect(Number(r.quantityDelivered)).toBe(10);
    expect(await creditsFor(id)).toEqual([4]);
    expect(await stockOf(material)).toBe(4);
    expect(await auditCount(id)).toBe(audits);
  });

  it('a fully accepted delivery cannot be switched to partially accepted', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 10);
    expect((await patch(pm, d.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    const res = await patch(pm, d.id, { acceptanceStatus: 'partially_accepted', quantityAccepted: 4 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatch(/switched between accepted and partially accepted/);
    expect(await stockOf(material)).toBe(10);
    expect((await row(d.id)).quantityAccepted).toBeNull();
  });

  it('cannot be deleted (goods in stock)', async () => {
    const { id } = await partial(10, 4);
    const res = await app.inject({
      method: 'DELETE', url: `${base()}/${id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(res.statusCode).toBe(409);
  });

  it('stock never goes negative and matches its transactions', async () => {
    const material = newMaterial();
    const a = await makeDelivery(material, 10);
    const b = await makeDelivery(material, 5);
    expect((await patch(pm, a.id, { acceptanceStatus: 'partially_accepted', quantityAccepted: 2.25 })).statusCode).toBe(200);
    expect((await patch(pm, b.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    const inv = await prisma.siteInventory.findUniqueOrThrow({
      where: { siteId_materialName_unitOfMeasure: { siteId, materialName: material, unitOfMeasure: UNIT } },
      include: { transactions: true },
    });
    const sum = inv.transactions.reduce((s, t) => s + Number(t.quantity), 0);
    expect(Number(inv.currentQuantity)).toBe(7.25);
    expect(sum).toBe(7.25);
    expect(inv.transactions.every((t) => Number(t.quantity) > 0)).toBe(true);
  });
});

// ─── Records made before the accepted quantity existed ───────────────────────

describe('a partially accepted delivery recorded before the accepted quantity existed', () => {
  async function historical(quantity = 10) {
    // Recorded by the earlier code: partially accepted, credited in full,
    // no accepted quantity.
    const material = newMaterial();
    const d = await makeDelivery(material, quantity);
    expect((await patch(pm, d.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    await prisma.deliveryRecord.update({ where: { id: d.id }, data: { acceptanceStatus: 'partially_accepted' } });
    return { id: d.id, material };
  }

  it('is returned with no accepted quantity and stays editable; its stock is untouched', async () => {
    const { id, material } = await historical(10);
    const got = await app.inject({
      method: 'GET', url: `${base()}/${id}`, headers: { authorization: `Bearer ${pm.accessToken}` },
    });
    expect(got.json().delivery.quantityAccepted).toBeNull();

    const res = await patch(pm, id, {
      itemDescription: material, unitOfMeasure: UNIT, quantityDelivered: 10, quantityAccepted: null,
      acceptanceStatus: 'partially_accepted', comments: 'reviewed',
    });
    expect(res.statusCode).toBe(200);
    const r = await row(id);
    expect(r.quantityAccepted).toBeNull();
    expect(r.comments).toBe('reviewed');
    expect(await creditsFor(id)).toEqual([10]);
    expect(await stockOf(material)).toBe(10);
  });

  it('an accepted quantity cannot be added to it afterwards (409), nothing guessed', async () => {
    const { id, material } = await historical(10);
    expect((await patch(pm, id, { quantityAccepted: 6 })).statusCode).toBe(409);
    expect((await row(id)).quantityAccepted).toBeNull();
    expect(await stockOf(material)).toBe(10);
  });

  it('the delivery list shows it with a null accepted quantity', async () => {
    const { id } = await historical(10);
    const res = await app.inject({
      method: 'GET', url: base(), headers: { authorization: `Bearer ${pm.accessToken}` },
    });
    const listed = res.json().deliveries.find((x: { id: string }) => x.id === id);
    expect(listed.acceptanceStatus).toBe('partially_accepted');
    expect(listed.quantityAccepted).toBeNull();
  });
});

// ─── Concurrency ──────────────────────────────────────────────────────────────

describe('simultaneous requests', () => {
  it('identical partial acceptances: all succeed, credited once at the accepted quantity', async () => {
    for (let round = 0; round < 4; round++) {
      const material = newMaterial();
      const d = await makeDelivery(material, 20);
      const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
        patch(i % 2 ? pm : supervisor, d.id, { acceptanceStatus: 'partially_accepted', quantityAccepted: 15 })));
      expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(200));
      expect(await creditsFor(d.id)).toEqual([15]);
      expect(await stockOf(material)).toBe(15);
    }
  });

  it('partial acceptances with different quantities: one wins, the rest get 409, stock equals the stored quantity', async () => {
    for (let round = 0; round < 4; round++) {
      const material = newMaterial();
      const d = await makeDelivery(material, 20);
      const results = await Promise.all([2, 4, 6, 8, 10].map((q) =>
        patch(pm, d.id, { acceptanceStatus: 'partially_accepted', quantityAccepted: q })));
      const codes = results.map((r) => r.statusCode).sort();
      expect(codes).toEqual([200, 409, 409, 409, 409]);
      const stored = Number((await row(d.id)).quantityAccepted);
      expect(await creditsFor(d.id)).toEqual([stored]);
      expect(await stockOf(material)).toBe(stored);
    }
  });

  it('a full and a partial acceptance at once: one wins, credited once at its own quantity', async () => {
    for (let round = 0; round < 6; round++) {
      const material = newMaterial();
      const d = await makeDelivery(material, 10);
      const [full, part] = await Promise.all([
        patch(pm, d.id, { acceptanceStatus: 'accepted' }),
        new Promise((r) => setTimeout(r, round)).then(() =>
          patch(supervisor, d.id, { acceptanceStatus: 'partially_accepted', quantityAccepted: 4 })),
      ]);
      expect([full.statusCode, part.statusCode].sort()).toEqual([200, 409]);
      const r = await row(d.id);
      const expected = r.acceptanceStatus === 'accepted' ? 10 : 4;
      expect(r.acceptanceStatus === 'accepted' ? full.statusCode : part.statusCode).toBe(200);
      expect(await creditsFor(d.id)).toEqual([expected]);
      expect(await stockOf(material)).toBe(expected);
    }
  });
});

// ─── Roles and scope unchanged ───────────────────────────────────────────────

describe('roles and scope', () => {
  it('another company\'s admin gets 404 and nothing is credited', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 10);
    expect((await patch(foreignAdmin, d.id, { acceptanceStatus: 'partially_accepted', quantityAccepted: 3 })).statusCode).toBe(404);
    expect(await stockOf(material)).toBe(0);
  });

  it('a supervisor not assigned to the delivery\'s site gets 404', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 10, otherSiteId);
    const res = await patch(supervisor, d.id, { acceptanceStatus: 'partially_accepted', quantityAccepted: 3 }, otherSiteId);
    expect(res.statusCode).toBe(404);
    expect(await stockOf(material, otherSiteId)).toBe(0);
  });

  it('a finance officer cannot accept (403)', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 10);
    expect((await patch(finance, d.id, { acceptanceStatus: 'partially_accepted', quantityAccepted: 3 })).statusCode).toBe(403);
    expect(await stockOf(material)).toBe(0);
  });
});
