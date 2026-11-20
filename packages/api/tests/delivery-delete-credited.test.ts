/**
 * DELETE /projects/:projectId/sites/:siteId/deliveries/:deliveryId
 *
 * Once a delivery's goods have been added to site stock (a delivery_in
 * transaction exists for it), the delivery can no longer be deleted through
 * the ordinary delete endpoint: deleting it would leave stock that no delivery
 * explains. The request gets 409 CONFLICT, pointing to a stock adjustment, and
 * nothing changes: the delivery, its photos and documents, the stock
 * transaction, the stock quantity and the audit history all stay. Stock is
 * never reversed implicitly. A delivery that never credited stock is deleted
 * as before. The check and the delete run under the delivery's row lock, so a
 * delete racing an accept can never leave stock credited for a delivery that
 * no longer exists. Roles and scoping are unchanged.
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

  const a = await createTestCompany(app, 'dlv-del');
  const b = await createTestCompany(app, 'dlv-del-b');
  companyId = a.company.id;
  admin = a.admin;
  foreignAdmin = b.admin;

  const project = await createTestProject(companyId, 'P1');
  const site = await createTestSite(companyId, project.id, 'S1');
  const otherSite = await createTestSite(companyId, project.id, 'S2');
  projectId = project.id;
  siteId = site.id;
  otherSiteId = otherSite.id;

  pm = await createTestUser(app, companyId, 'project_manager', 'dlv-del-pm');
  supervisor = await createTestUser(app, companyId, 'site_supervisor', 'dlv-del-sup');
  finance = await createTestUser(app, companyId, 'finance_officer', 'dlv-del-fin');
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
  return `Cement-${seq}-${Math.random().toString(36).slice(2, 8)}`;
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

function url(deliveryId: string, site = siteId) {
  return `/api/v1/projects/${projectId}/sites/${site}/deliveries/${deliveryId}`;
}

function patch(user: TestUser, deliveryId: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: url(deliveryId),
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: body,
  });
}

function del(user: TestUser, deliveryId: string, site = siteId) {
  return app.inject({
    method: 'DELETE',
    url: url(deliveryId, site),
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
}

/** A pending delivery accepted through the API, so its goods are in stock. */
async function acceptedDelivery(quantity = 10, status: 'accepted' | 'partially_accepted' = 'accepted') {
  const material = newMaterial();
  const d = await makeDelivery(material, quantity);
  const res = await patch(pm, d.id, { acceptanceStatus: 'accepted' });
  expect(res.statusCode).toBe(200);
  // Partial acceptance of delivered goods is refused for now; a partially
  // accepted delivery in stock is one recorded before that rule.
  if (status === 'partially_accepted') {
    await prisma.deliveryRecord.update({ where: { id: d.id }, data: { acceptanceStatus: status } });
  }
  return { id: d.id, material };
}

async function attachFiles(deliveryId: string) {
  await prisma.deliveryPhoto.create({
    data: {
      deliveryRecordId: deliveryId, companyId,
      fileUrl: '/uploads/photos/test.jpg', fileKey: 'photos/test.jpg',
      fileName: 'test.jpg', fileSizeBytes: 10, uploadedById: admin.id,
    },
  });
  await prisma.deliveryDocument.create({
    data: {
      deliveryRecordId: deliveryId, companyId,
      fileUrl: '/uploads/documents/note.pdf', fileKey: 'documents/note.pdf',
      fileName: 'note.pdf', fileSizeBytes: 10, fileType: 'application/pdf', uploadedById: admin.id,
    },
  });
}

async function stockOf(material: string): Promise<number> {
  const row = await prisma.siteInventory.findUnique({
    where: { siteId_materialName_unitOfMeasure: { siteId, materialName: material, unitOfMeasure: UNIT } },
  });
  return row ? Number(row.currentQuantity) : 0;
}

/** delivery_in transactions for a material, whether or not they still point at a delivery. */
function creditsForMaterial(material: string) {
  return prisma.inventoryTransaction.count({
    where: { type: 'delivery_in', inventory: { siteId, materialName: material } },
  });
}

function creditsFor(deliveryId: string) {
  return prisma.inventoryTransaction.count({ where: { deliveryId, type: 'delivery_in' } });
}

function audits(id: string) {
  return prisma.auditLog.count({ where: { entityType: 'delivery_record', entityId: id } });
}

async function snapshot(id: string, material: string) {
  return {
    row: await prisma.deliveryRecord.findUnique({ where: { id } }),
    photos: await prisma.deliveryPhoto.count({ where: { deliveryRecordId: id } }),
    documents: await prisma.deliveryDocument.count({ where: { deliveryRecordId: id } }),
    credits: await creditsFor(id),
    stock: await stockOf(material),
    audits: await audits(id),
  };
}

// ─── Credited deliveries are not deleted ─────────────────────────────────────

describe('deleting a delivery whose goods are in stock', () => {
  it.each(['accepted', 'partially_accepted'] as const)(
    'a %s delivery is refused with 409 and nothing changes',
    async (status) => {
      const { id, material } = await acceptedDelivery(10, status);
      await attachFiles(id);
      const before = await snapshot(id, material);

      const res = await del(admin, id);

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('CONFLICT');
      expect(res.json().error).toMatch(/already been added to site stock/);
      expect(res.json().error).toMatch(/stock adjustment/);
      expect(res.json().error).toMatch(/company admin or project manager/);

      const after = await snapshot(id, material);
      expect(after).toEqual(before);
      expect(after.row).not.toBeNull();
      expect(after.photos).toBe(1);
      expect(after.documents).toBe(1);
      expect(after.credits).toBe(1);
      expect(after.stock).toBe(10);
      expect(await prisma.auditLog.count({
        where: { entityType: 'delivery_record', entityId: id, action: 'delete' },
      })).toBe(0);
    },
  );

  it('project managers get the same 409 (no role bypass)', async () => {
    const { id, material } = await acceptedDelivery(5);
    const res = await del(pm, id);
    expect(res.statusCode).toBe(409);
    expect(await prisma.deliveryRecord.findUnique({ where: { id } })).not.toBeNull();
    expect(await stockOf(material)).toBe(5);
  });

  it('a delivery created already accepted is refused too', async () => {
    const material = newMaterial();
    const created = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/sites/${siteId}/deliveries`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: {
        supplierName: 'Test Supplier Ltd', deliveryDate: '2026-04-02',
        itemDescription: material, unitOfMeasure: UNIT,
        quantityOrdered: 4, quantityDelivered: 4,
        acceptanceStatus: 'accepted', receivedById: admin.id,
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().delivery.id as string;

    expect((await del(admin, id)).statusCode).toBe(409);
    expect(await creditsFor(id)).toBe(1);
    expect(await stockOf(material)).toBe(4);
  });

  it('a delivery rejected after its credit (before that was refused) still keeps its stock and is refused', async () => {
    const { id, material } = await acceptedDelivery(6);
    // Older records: rejected after the credit, credit kept.
    await prisma.deliveryRecord.update({ where: { id }, data: { acceptanceStatus: 'rejected' } });

    expect((await del(admin, id)).statusCode).toBe(409);
    expect(await creditsFor(id)).toBe(1);
    expect(await stockOf(material)).toBe(6);
  });

  it('a credited delivery whose goods were partly used is refused and stock is not touched', async () => {
    const { id, material } = await acceptedDelivery(10);
    await prisma.siteInventory.update({
      where: { siteId_materialName_unitOfMeasure: { siteId, materialName: material, unitOfMeasure: UNIT } },
      data: { currentQuantity: 3 },
    });
    expect((await del(admin, id)).statusCode).toBe(409);
    expect(await stockOf(material)).toBe(3);
  });
});

// ─── Uncredited deliveries are deleted as before ─────────────────────────────

describe('deleting a delivery that never added stock', () => {
  it('a pending delivery is deleted, with its photos and documents, and audited', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 10);
    await attachFiles(d.id);

    const res = await del(admin, d.id);

    expect(res.statusCode).toBe(204);
    expect(await prisma.deliveryRecord.findUnique({ where: { id: d.id } })).toBeNull();
    expect(await prisma.deliveryPhoto.count({ where: { deliveryRecordId: d.id } })).toBe(0);
    expect(await prisma.deliveryDocument.count({ where: { deliveryRecordId: d.id } })).toBe(0);
    expect(await stockOf(material)).toBe(0);

    const log = await prisma.auditLog.findFirst({
      where: { entityType: 'delivery_record', entityId: d.id, action: 'delete' },
    });
    expect(log).toBeTruthy();
    expect(log!.userId).toBe(admin.id);
    expect((log!.changesBefore as { itemDescription: string }).itemDescription).toBe(material);
  });

  it('a delivery rejected before acceptance is deleted by a project manager', async () => {
    const d = await makeDelivery(newMaterial(), 10);
    expect((await patch(supervisor, d.id, { acceptanceStatus: 'rejected', rejectionReason: 'late' })).statusCode).toBe(200);
    expect((await del(pm, d.id)).statusCode).toBe(204);
    expect(await prisma.deliveryRecord.findUnique({ where: { id: d.id } })).toBeNull();
  });

  it('an accepted delivery of quantity 0 (nothing credited) is deleted', async () => {
    const material = newMaterial();
    const d = await makeDelivery(material, 0);
    expect((await patch(pm, d.id, { acceptanceStatus: 'accepted' })).statusCode).toBe(200);
    expect(await creditsFor(d.id)).toBe(0);
    expect((await del(admin, d.id)).statusCode).toBe(204);
    expect(await prisma.deliveryRecord.findUnique({ where: { id: d.id } })).toBeNull();
  });
});

// ─── Roles and scope unchanged ───────────────────────────────────────────────

describe('roles and scope', () => {
  it.each([
    ['site_supervisor', () => supervisor],
    ['finance_officer', () => finance],
  ] as const)('a %s still gets 403 on a credited and an uncredited delivery', async (_r, who) => {
    const credited = await acceptedDelivery(3);
    const pending = await makeDelivery(newMaterial(), 3);
    expect((await del(who(), credited.id)).statusCode).toBe(403);
    expect((await del(who(), pending.id)).statusCode).toBe(403);
    expect(await prisma.deliveryRecord.count({ where: { id: { in: [credited.id, pending.id] } } })).toBe(2);
  });

  it('another company\'s admin still gets 404 on a credited and an uncredited delivery', async () => {
    const credited = await acceptedDelivery(3);
    const pending = await makeDelivery(newMaterial(), 3);
    expect((await del(foreignAdmin, credited.id)).statusCode).toBe(404);
    expect((await del(foreignAdmin, pending.id)).statusCode).toBe(404);
    expect(await prisma.deliveryRecord.count({ where: { id: { in: [credited.id, pending.id] } } })).toBe(2);
    expect(await stockOf(credited.material)).toBe(3);
  });

  it('the wrong site in the URL is still a 404 (credited and uncredited)', async () => {
    const credited = await acceptedDelivery(3);
    const pending = await makeDelivery(newMaterial(), 3);
    expect((await del(admin, credited.id, otherSiteId)).statusCode).toBe(404);
    expect((await del(admin, pending.id, otherSiteId)).statusCode).toBe(404);
    expect(await prisma.deliveryRecord.count({ where: { id: { in: [credited.id, pending.id] } } })).toBe(2);
  });

  it('an unknown delivery is still a 404', async () => {
    expect((await del(admin, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });
});

// ─── Concurrency ──────────────────────────────────────────────────────────────

describe('a delete racing an accept of one pending delivery', () => {
  it('ends either deleted with no stock, or accepted, credited once and still present', async () => {
    const outcomes = { deleted: 0, kept: 0 };
    for (let i = 0; i < 10; i++) {
      const material = newMaterial();
      const d = await makeDelivery(material, 10);

      // The delete starts 0-9 ms after the accept, so both orders occur.
      const [acc, rm] = await Promise.all([
        patch(supervisor, d.id, { acceptanceStatus: 'accepted' }),
        new Promise((r) => setTimeout(r, i)).then(() => del(admin, d.id)),
      ]);

      const row = await prisma.deliveryRecord.findUnique({ where: { id: d.id } });
      const credits = await creditsForMaterial(material);
      const stock = await stockOf(material);

      if (rm.statusCode === 204) {
        // The delete came first; the accept then found no delivery.
        outcomes.deleted += 1;
        expect(acc.statusCode).toBe(404);
        expect(row).toBeNull();
        expect(credits).toBe(0);
        expect(stock).toBe(0);
      } else {
        // The accept came first; the delete was refused.
        outcomes.kept += 1;
        expect(rm.statusCode).toBe(409);
        expect(acc.statusCode).toBe(200);
        expect(row?.acceptanceStatus).toBe('accepted');
        expect(credits).toBe(1);
        expect(await creditsFor(d.id)).toBe(1);
        expect(stock).toBe(10);
      }
    }
    expect(outcomes.deleted + outcomes.kept).toBe(10);
  });
});
