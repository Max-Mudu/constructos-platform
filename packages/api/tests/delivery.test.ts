import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestDelivery,
  assignUserToProject,
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BASE = (pid: string, sid: string) =>
  `/api/v1/projects/${pid}/sites/${sid}/deliveries`;

function validPayload(receivedById: string) {
  return {
    supplierName: 'Acme Materials Ltd',
    deliveryDate: '2026-04-01',
    deliveryTime: '09:30',
    driverName: 'John Kamau',
    vehicleRegistration: 'KAB 123A',
    purchaseOrderNumber: 'PO-2026-001',
    deliveryNoteNumber: 'DN-001',
    itemDescription: 'Portland Cement 50kg bags',
    unitOfMeasure: 'bags',
    quantityOrdered: 200,
    quantityDelivered: 200,
    conditionOnArrival: 'good',
    inspectionStatus: 'pending',
    acceptanceStatus: 'accepted',
    receivedById,
  };
}

// ─── POST — Create ────────────────────────────────────────────────────────────

describe('POST /deliveries', () => {
  it('company_admin can create a delivery', async () => {
    const { company, admin } = await createTestCompany(app, 'del-create-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: validPayload(admin.id),
    });

    expect(res.statusCode).toBe(201);
    const { delivery } = res.json();
    expect(delivery.supplierName).toBe('Acme Materials Ltd');
    expect(delivery.itemDescription).toBe('Portland Cement 50kg bags');
    expect(delivery.quantityOrdered).toBe('200');    // Prisma Decimal → string
    expect(delivery.quantityDelivered).toBe('200');
    expect(delivery.acceptanceStatus).toBe('accepted');
    expect(delivery.receivedBy.id).toBe(admin.id);
    expect(delivery.companyId).toBe(company.id);
    expect(delivery.projectId).toBe(project.id);
    expect(delivery.siteId).toBe(site.id);
  });

  it('project_manager assigned to project can create a delivery', async () => {
    const { company } = await createTestCompany(app, 'del-create-2');
    const pm      = await createTestUser(app, company.id, 'project_manager', 'pm-dc2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, pm.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: validPayload(pm.id),
    });

    expect(res.statusCode).toBe(201);
  });

  it('site_supervisor assigned to site can create a delivery', async () => {
    const { company } = await createTestCompany(app, 'del-create-3');
    const sup     = await createTestUser(app, company.id, 'site_supervisor', 'sup-dc3');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: validPayload(sup.id),
    });

    expect(res.statusCode).toBe(201);
  });

  it('site_supervisor assigned to different site gets 404', async () => {
    const { company } = await createTestCompany(app, 'del-create-4');
    const sup      = await createTestUser(app, company.id, 'site_supervisor', 'sup-dc4');
    const project  = await createTestProject(company.id);
    const siteA    = await createTestSite(company.id, project.id, 'Site A');
    const siteB    = await createTestSite(company.id, project.id, 'Site B');
    await assignUserToProject(company.id, project.id, sup.id, siteA.id); // assigned to A only

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, siteB.id), // tries to access B
      headers: { authorization: `Bearer ${sup.accessToken}` },
      payload: validPayload(sup.id),
    });

    expect(res.statusCode).toBe(404);
  });

  it('finance_officer cannot create a delivery — 403', async () => {
    const { company } = await createTestCompany(app, 'del-create-5');
    const fo      = await createTestUser(app, company.id, 'finance_officer', 'fo-dc5');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${fo.accessToken}` },
      payload: validPayload(fo.id),
    });

    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated request is rejected — 401', async () => {
    const { company } = await createTestCompany(app, 'del-create-6');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      payload: { supplierName: 'x' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('cross-tenant project returns 404', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'del-create-7a');
    const { company: c2 }            = await createTestCompany(app, 'del-create-7b');
    const project = await createTestProject(c2.id); // belongs to c2
    const site    = await createTestSite(c2.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${a1.accessToken}` }, // c1 token
      payload: validPayload(a1.id),
    });

    expect(res.statusCode).toBe(404); // project not found in c1
  });

  it('returns 422 on missing required fields', async () => {
    const { company, admin } = await createTestCompany(app, 'del-create-8');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { supplierName: 'x' }, // missing itemDescription, unitOfMeasure, etc.
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('rejects budgetLineItemId from a different project — 422', async () => {
    const { company, admin } = await createTestCompany(app, 'del-bli-1');
    const projectA = await createTestProject(company.id, 'Project A');
    const projectB = await createTestProject(company.id, 'Project B');
    const site     = await createTestSite(company.id, projectA.id);

    // Create a budget line item in projectB
    const budget = await prisma.budget.create({
      data: { companyId: company.id, projectId: projectB.id, name: 'B Budget' },
    });
    const lineItem = await prisma.budgetLineItem.create({
      data: {
        budgetId: budget.id,
        companyId: company.id,
        projectId: projectB.id,
        category: 'materials',
        description: 'B materials',
        budgetedAmount: 1000,
        currency: 'USD',
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: BASE(projectA.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { ...validPayload(admin.id), budgetLineItemId: lineItem.id },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('writes an audit log on creation', async () => {
    const { company, admin } = await createTestCompany(app, 'del-create-audit');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: validPayload(admin.id),
    });

    const deliveryId = res.json().delivery.id;
    const log = await prisma.auditLog.findFirst({
      where: { action: 'create', entityType: 'delivery_record', entityId: deliveryId },
    });
    expect(log).toBeTruthy();
    expect(log?.userId).toBe(admin.id);
  });

  it('rejected delivery stores rejection reason', async () => {
    const { company, admin } = await createTestCompany(app, 'del-create-reject');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        ...validPayload(admin.id),
        acceptanceStatus: 'rejected',
        conditionOnArrival: 'damaged',
        rejectionReason: 'Cement bags torn and wet on arrival',
        quantityDelivered: 0,
      },
    });

    expect(res.statusCode).toBe(201);
    const { delivery } = res.json();
    expect(delivery.acceptanceStatus).toBe('rejected');
    expect(delivery.conditionOnArrival).toBe('damaged');
    expect(delivery.rejectionReason).toBe('Cement bags torn and wet on arrival');
  });

  it('partially accepted delivery stores discrepancy notes', async () => {
    const { company, admin } = await createTestCompany(app, 'del-create-partial');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'POST',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        ...validPayload(admin.id),
        acceptanceStatus: 'partially_accepted',
        quantityOrdered: 200,
        quantityDelivered: 150,
        discrepancyNotes: '50 bags short-delivered per DN count',
      },
    });

    expect(res.statusCode).toBe(201);
    const { delivery } = res.json();
    expect(delivery.acceptanceStatus).toBe('partially_accepted');
    expect(delivery.quantityDelivered).toBe('150');
    expect(delivery.discrepancyNotes).toBe('50 bags short-delivered per DN count');
  });
});

// ─── GET list ─────────────────────────────────────────────────────────────────

describe('GET /deliveries', () => {
  it('company_admin sees all deliveries for the site', async () => {
    const { company, admin } = await createTestCompany(app, 'del-list-1');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await createTestDelivery(company.id, project.id, site.id, admin.id, { supplierName: 'Supplier A' });
    await createTestDelivery(company.id, project.id, site.id, admin.id, { supplierName: 'Supplier B' });

    const res = await app.inject({
      method: 'GET',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { deliveries } = res.json();
    expect(deliveries).toHaveLength(2);
  });

  it('finance_officer can view deliveries (read-only access)', async () => {
    const { company } = await createTestCompany(app, 'del-list-2');
    const fo      = await createTestUser(app, company.id, 'finance_officer', 'fo-dl2', { canViewFinance: true });
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-dl2');
    await createTestDelivery(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'GET',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${fo.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deliveries).toHaveLength(1);
  });

  it('site_supervisor sees only deliveries for their assigned site', async () => {
    const { company } = await createTestCompany(app, 'del-list-3');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-dl3');
    const sup     = await createTestUser(app, company.id, 'site_supervisor', 'sup-dl3');
    const project = await createTestProject(company.id);
    const siteA   = await createTestSite(company.id, project.id, 'Site A');
    const siteB   = await createTestSite(company.id, project.id, 'Site B');
    await assignUserToProject(company.id, project.id, sup.id, siteA.id);
    await createTestDelivery(company.id, project.id, siteA.id, admin.id);
    await createTestDelivery(company.id, project.id, siteB.id, admin.id);

    // Supervisor can see siteA deliveries
    const resA = await app.inject({
      method: 'GET',
      url: BASE(project.id, siteA.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });
    expect(resA.statusCode).toBe(200);
    expect(resA.json().deliveries).toHaveLength(1);

    // Supervisor cannot see siteB deliveries
    const resB = await app.inject({
      method: 'GET',
      url: BASE(project.id, siteB.id),
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });
    expect(resB.statusCode).toBe(404);
  });

  it('returns empty array when no deliveries exist', async () => {
    const { company, admin } = await createTestCompany(app, 'del-list-4');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'GET',
      url: BASE(project.id, site.id),
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deliveries).toHaveLength(0);
  });

  it('does not leak deliveries from another company', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'del-list-5a');
    const { company: c2, admin: a2 } = await createTestCompany(app, 'del-list-5b');
    const p1 = await createTestProject(c1.id);
    const p2 = await createTestProject(c2.id);
    const s1 = await createTestSite(c1.id, p1.id);
    const s2 = await createTestSite(c2.id, p2.id);
    await createTestDelivery(c2.id, p2.id, s2.id, a2.id);

    // c1 admin queries p1/s1 — should get 0 results, not c2's delivery
    const res = await app.inject({
      method: 'GET',
      url: BASE(p1.id, s1.id),
      headers: { authorization: `Bearer ${a1.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().deliveries).toHaveLength(0);
  });
});

// ─── GET single ───────────────────────────────────────────────────────────────

describe('GET /deliveries/:deliveryId', () => {
  it('returns delivery with receivedBy user', async () => {
    const { company, admin } = await createTestCompany(app, 'del-get-1');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}/${delivery.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(200);
    const { delivery: d } = res.json();
    expect(d.id).toBe(delivery.id);
    expect(d.receivedBy.id).toBe(admin.id);
  });

  it('returns 404 for non-existent delivery', async () => {
    const { company, admin } = await createTestCompany(app, 'del-get-2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);

    const res = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}/00000000-0000-0000-0000-000000000000`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

// ─── PATCH — Update ───────────────────────────────────────────────────────────

describe('PATCH /deliveries/:deliveryId', () => {
  it('company_admin can update inspection status and acceptance', async () => {
    const { company, admin } = await createTestCompany(app, 'del-update-1');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE(project.id, site.id)}/${delivery.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        inspectionStatus: 'passed',
        acceptanceStatus: 'accepted',
      },
    });

    expect(res.statusCode).toBe(200);
    const { delivery: d } = res.json();
    expect(d.inspectionStatus).toBe('passed');
    expect(d.acceptanceStatus).toBe('accepted');
  });

  it('project_manager can update delivery in their project', async () => {
    const { company } = await createTestCompany(app, 'del-update-2');
    const pm      = await createTestUser(app, company.id, 'project_manager', 'pm-du2');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-du2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, pm.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE(project.id, site.id)}/${delivery.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
      payload: { comments: 'All items verified correct' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().delivery.comments).toBe('All items verified correct');
  });

  it('finance_officer cannot update — 403', async () => {
    const { company } = await createTestCompany(app, 'del-update-3');
    const fo      = await createTestUser(app, company.id, 'finance_officer', 'fo-du3');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-du3');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `${BASE(project.id, site.id)}/${delivery.id}`,
      headers: { authorization: `Bearer ${fo.accessToken}` },
      payload: { comments: 'should fail' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('writes audit log on update', async () => {
    const { company, admin } = await createTestCompany(app, 'del-update-audit');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    await app.inject({
      method: 'PATCH',
      url: `${BASE(project.id, site.id)}/${delivery.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { inspectionStatus: 'passed' },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'update', entityType: 'delivery_record', entityId: delivery.id },
    });
    expect(log).toBeTruthy();
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /deliveries/:deliveryId', () => {
  it('company_admin can delete a delivery', async () => {
    const { company, admin } = await createTestCompany(app, 'del-delete-1');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `${BASE(project.id, site.id)}/${delivery.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    expect(res.statusCode).toBe(204);

    // Verify deleted
    const check = await app.inject({
      method: 'GET',
      url: `${BASE(project.id, site.id)}/${delivery.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });
    expect(check.statusCode).toBe(404);
  });

  it('site_supervisor cannot delete — 403', async () => {
    const { company } = await createTestCompany(app, 'del-delete-2');
    const admin   = await createTestUser(app, company.id, 'company_admin', 'adm-dd2');
    const sup     = await createTestUser(app, company.id, 'site_supervisor', 'sup-dd2');
    const project = await createTestProject(company.id);
    const site    = await createTestSite(company.id, project.id);
    await assignUserToProject(company.id, project.id, sup.id, site.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    const res = await app.inject({
      method: 'DELETE',
      url: `${BASE(project.id, site.id)}/${delivery.id}`,
      headers: { authorization: `Bearer ${sup.accessToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('site_supervisor assigned to different site cannot delete — 404', async () => {
    const { company } = await createTestCompany(app, 'del-delete-site');
    const admin  = await createTestUser(app, company.id, 'company_admin', 'adm-dds');
    // Use project_manager role (has DELETE permission) but scoped to wrong site
    const pm     = await createTestUser(app, company.id, 'project_manager', 'pm-dds');
    const project = await createTestProject(company.id);
    const siteA   = await createTestSite(company.id, project.id, 'Site A');
    const siteB   = await createTestSite(company.id, project.id, 'Site B');
    await assignUserToProject(company.id, project.id, pm.id);
    const delivery = await createTestDelivery(company.id, project.id, siteA.id, admin.id);

    // PM tries to delete from siteB (delivery doesn't belong to siteB)
    const res = await app.inject({
      method: 'DELETE',
      url: `${BASE(project.id, siteB.id)}/${delivery.id}`,
      headers: { authorization: `Bearer ${pm.accessToken}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('writes audit log on deletion', async () => {
    const { company, admin } = await createTestCompany(app, 'del-delete-audit');
    const project  = await createTestProject(company.id);
    const site     = await createTestSite(company.id, project.id);
    const delivery = await createTestDelivery(company.id, project.id, site.id, admin.id);

    await app.inject({
      method: 'DELETE',
      url: `${BASE(project.id, site.id)}/${delivery.id}`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
    });

    const log = await prisma.auditLog.findFirst({
      where: { action: 'delete', entityType: 'delivery_record', entityId: delivery.id },
    });
    expect(log).toBeTruthy();
  });
});
