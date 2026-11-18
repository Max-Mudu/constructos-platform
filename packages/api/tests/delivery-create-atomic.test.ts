/**
 * POST /projects/:projectId/sites/:siteId/deliveries
 *
 * A delivery, its audit row and (when it is created already accepted) the
 * inventory credit are written together: if any of them fails, none of them is
 * kept, and the "delivery created" live event is sent only after they are
 * saved. Roles, scoping and the response are unchanged.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import * as inventoryService from '../src/services/inventory.service';
import * as eventEmitter from '../src/services/event-emitter.service';
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

  const a = await createTestCompany(app, 'dlv-atomic');
  companyId = a.company.id;
  admin = a.admin;

  const project = await createTestProject(companyId, 'P1');
  const site = await createTestSite(companyId, project.id, 'S1');
  projectId = project.id;
  siteId = site.id;

  supervisor = await createTestUser(app, companyId, 'site_supervisor', 'dlv-atomic-sup');
  await assignUserToProject(companyId, projectId, supervisor.id, siteId);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

/** A material name no other test in this file uses, so each test owns its rows. */
function newMaterial(): string {
  seq += 1;
  return `Rebar-${seq}-${Math.random().toString(36).slice(2, 8)}`;
}

function create(user: TestUser, material: string, extra: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/sites/${siteId}/deliveries`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: {
      supplierName: 'Test Supplier Ltd',
      deliveryDate: '2026-04-05',
      itemDescription: material,
      unitOfMeasure: UNIT,
      quantityOrdered: 12,
      quantityDelivered: 12,
      receivedById: admin.id,
      ...extra,
    },
  });
}

function deliveriesOf(material: string) {
  return prisma.deliveryRecord.findMany({ where: { companyId, itemDescription: material } });
}

function createAuditRows(entityId?: string) {
  return prisma.auditLog.findMany({
    where: { companyId, entityType: 'delivery_record', action: 'create', ...(entityId && { entityId }) },
  });
}

function stockRow(material: string) {
  return prisma.siteInventory.findUnique({
    where: { siteId_materialName_unitOfMeasure: { siteId, materialName: material, unitOfMeasure: UNIT } },
  });
}

describe('creating a delivery that is already accepted', () => {
  it('saves the delivery, one audit row, the stock credit and its transaction', async () => {
    const material = newMaterial();
    const emit = jest.spyOn(eventEmitter, 'emitToCompany');

    const res = await create(supervisor, material, { acceptanceStatus: 'accepted' });

    expect(res.statusCode).toBe(201);
    const id = res.json().delivery.id as string;
    expect(await deliveriesOf(material)).toHaveLength(1);
    expect(await createAuditRows(id)).toHaveLength(1);
    expect(Number((await stockRow(material))?.currentQuantity)).toBe(12);
    const credits = await prisma.inventoryTransaction.findMany({ where: { deliveryId: id } });
    expect(credits).toHaveLength(1);
    expect(credits[0].type).toBe('delivery_in');
    expect(Number(credits[0].quantity)).toBe(12);
    expect(emit).toHaveBeenCalledWith(companyId, expect.objectContaining({ type: 'delivery_created' }));
  });

  it('keeps nothing when the stock credit fails', async () => {
    const material = newMaterial();
    const auditBefore = (await createAuditRows()).length;
    const emit = jest.spyOn(eventEmitter, 'emitToCompany');
    const credit = jest
      .spyOn(inventoryService, 'creditFromDelivery')
      .mockRejectedValueOnce(new Error('simulated failure while crediting stock'));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await create(supervisor, material, { acceptanceStatus: 'accepted' });

    expect(credit).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(500);
    expect(await deliveriesOf(material)).toHaveLength(0);
    expect((await createAuditRows()).length).toBe(auditBefore);
    expect(await stockRow(material)).toBeNull();
    expect(emit).not.toHaveBeenCalledWith(companyId, expect.objectContaining({ type: 'delivery_created' }));
    errorLog.mockRestore();
  });

  it('a later request succeeds after a failed one and is credited once', async () => {
    const material = newMaterial();
    jest
      .spyOn(inventoryService, 'creditFromDelivery')
      .mockRejectedValueOnce(new Error('simulated failure while crediting stock'));
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect((await create(supervisor, material, { acceptanceStatus: 'accepted' })).statusCode).toBe(500);
    const retry = await create(supervisor, material, { acceptanceStatus: 'accepted' });

    expect(retry.statusCode).toBe(201);
    expect(await deliveriesOf(material)).toHaveLength(1);
    expect(Number((await stockRow(material))?.currentQuantity)).toBe(12);
    expect(await prisma.inventoryTransaction.count({ where: { deliveryId: retry.json().delivery.id } })).toBe(1);
    errorLog.mockRestore();
  });
});

describe('creating a delivery with no acceptance decision', () => {
  it('saves the delivery and its audit row and credits nothing', async () => {
    const material = newMaterial();
    const credit = jest.spyOn(inventoryService, 'creditFromDelivery');

    const res = await create(supervisor, material);

    expect(res.statusCode).toBe(201);
    const id = res.json().delivery.id as string;
    expect(res.json().delivery.acceptanceStatus).toBeNull();
    expect(await createAuditRows(id)).toHaveLength(1);
    expect(await stockRow(material)).toBeNull();
    expect(credit).not.toHaveBeenCalled();
  });

  it('a rejected delivery is saved and credits nothing', async () => {
    const material = newMaterial();

    const res = await create(supervisor, material, { acceptanceStatus: 'rejected', rejectionReason: 'damaged' });

    expect(res.statusCode).toBe(201);
    expect(await deliveriesOf(material)).toHaveLength(1);
    expect(await stockRow(material)).toBeNull();
  });
});
