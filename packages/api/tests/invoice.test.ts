import { buildApp } from '../src/server';
import { FastifyInstance } from 'fastify';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestContractor,
  createTestSupplier,
  createTestBudget,
  createTestLineItem,
  createTestInvoice,
  clearDatabase,
} from './helpers/fixtures';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await clearDatabase();
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

async function post(path: string, body: object, token: string) {
  return app.inject({ method: 'POST', url: path, payload: body, headers: { authorization: `Bearer ${token}` } });
}

async function get(path: string, token: string) {
  return app.inject({ method: 'GET', url: path, headers: { authorization: `Bearer ${token}` } });
}

async function patch(path: string, body: object, token: string) {
  return app.inject({ method: 'PATCH', url: path, payload: body, headers: { authorization: `Bearer ${token}` } });
}

async function del(path: string, token: string) {
  return app.inject({ method: 'DELETE', url: path, headers: { authorization: `Bearer ${token}` } });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Invoices — CRUD', () => {
  it('admin can create a contractor invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-create');
    const project = await createTestProject(company.id, 'Invoice Project');
    const contractor = await createTestContractor(company.id, 'ABC Builders');

    const res = await post('/api/v1/invoices', {
      projectId:    project.id,
      invoiceNumber: 'INV-001',
      vendorType:   'contractor',
      contractorId: contractor.id,
      vendorName:   'ABC Builders',
      subtotal:     50000,
      taxAmount:    7500,
      totalAmount:  57500,
      currency:     'USD',
      issueDate:    '2026-04-01',
      dueDate:      '2026-04-30',
      notes:        'First payment invoice',
      lineItems: [
        { description: 'Foundation works', quantity: 1, unitRate: 50000, amount: 50000 },
      ],
    }, admin.accessToken);

    expect(res.statusCode).toBe(201);
    const { invoice } = JSON.parse(res.payload);
    expect(invoice.invoiceNumber).toBe('INV-001');
    expect(invoice.vendorType).toBe('contractor');
    expect(invoice.status).toBe('draft');
    expect(Number(invoice.totalAmount)).toBe(57500);
    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.project.name).toBe('Invoice Project');
    expect(invoice.contractor.name).toBe('ABC Builders');
  });

  it('admin can create a consultant invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-consultant');
    const project = await createTestProject(company.id, 'Consultant Project');
    const consultantUser = await createTestUser(app, company.id, 'consultant', 'cons1');

    const res = await post('/api/v1/invoices', {
      projectId:       project.id,
      invoiceNumber:   'CONS-001',
      vendorType:      'consultant',
      consultantUserId: consultantUser.id,
      vendorName:      'Smith Architects',
      subtotal:        20000,
      taxAmount:       0,
      totalAmount:     20000,
      currency:        'USD',
      issueDate:       '2026-04-01',
      dueDate:         '2026-04-15',
    }, admin.accessToken);

    expect(res.statusCode).toBe(201);
    const { invoice } = JSON.parse(res.payload);
    expect(invoice.vendorType).toBe('consultant');
    expect(invoice.consultantUser).not.toBeNull();
    expect(invoice.consultantUserId).toBe(consultantUser.id);
  });

  it('admin can create a supplier invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-supplier');
    const project = await createTestProject(company.id, 'Supplier Project');
    const supplier = await createTestSupplier(company.id, { name: 'Cement Co' });

    const res = await post('/api/v1/invoices', {
      projectId:    project.id,
      invoiceNumber: 'SUP-001',
      vendorType:   'supplier',
      supplierId:   supplier.id,
      vendorName:   'Cement Co',
      subtotal:     8000,
      taxAmount:    1200,
      totalAmount:  9200,
      currency:     'USD',
      issueDate:    '2026-04-05',
      dueDate:      '2026-04-20',
    }, admin.accessToken);

    expect(res.statusCode).toBe(201);
    const { invoice } = JSON.parse(res.payload);
    expect(invoice.vendorType).toBe('supplier');
    expect(invoice.supplierId).toBe(supplier.id);
    expect(invoice.supplier.name).toBe('Cement Co');
  });

  it('admin can create a marketing invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-marketing');
    const project = await createTestProject(company.id, 'Marketing Project');

    const res = await post('/api/v1/invoices', {
      projectId:    project.id,
      invoiceNumber: 'MKT-001',
      vendorType:   'marketing',
      vendorName:   'DigitalAds Agency',
      subtotal:     5000,
      taxAmount:    0,
      totalAmount:  5000,
      currency:     'USD',
      issueDate:    '2026-04-01',
      dueDate:      '2026-04-30',
    }, admin.accessToken);

    expect(res.statusCode).toBe(201);
    const { invoice } = JSON.parse(res.payload);
    expect(invoice.vendorType).toBe('marketing');
  });

  it('rejects duplicate invoice numbers in same company', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-dup');
    const project = await createTestProject(company.id);

    await createTestInvoice(company.id, project.id, { invoiceNumber: 'INV-001' });

    const res = await post('/api/v1/invoices', {
      projectId:    project.id,
      invoiceNumber: 'INV-001',
      vendorType:   'contractor',
      vendorName:   'Another Co',
      subtotal:     1000,
      totalAmount:  1000,
      issueDate:    '2026-04-01',
      dueDate:      '2026-04-30',
    }, admin.accessToken);

    expect(res.statusCode).toBe(409);
  });

  it('viewer cannot create invoices', async () => {
    const { company } = await createTestCompany(app, 'inv-rbac-viewer');
    const project = await createTestProject(company.id);
    const viewer = await createTestUser(app, company.id, 'viewer', 'v1');

    const res = await post('/api/v1/invoices', {
      projectId:    project.id,
      invoiceNumber: 'INV-X',
      vendorType:   'contractor',
      vendorName:   'X',
      subtotal:     1000,
      totalAmount:  1000,
      issueDate:    '2026-04-01',
      dueDate:      '2026-04-30',
    }, viewer.accessToken);

    expect(res.statusCode).toBe(403);
  });

  it('can list invoices for a company', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-list');
    const project = await createTestProject(company.id);
    await createTestInvoice(company.id, project.id, { invoiceNumber: 'INV-A', status: 'draft' });
    await createTestInvoice(company.id, project.id, { invoiceNumber: 'INV-B', status: 'approved' });

    const res = await get('/api/v1/invoices', admin.accessToken);
    expect(res.statusCode).toBe(200);
    const { invoices } = JSON.parse(res.payload);
    expect(invoices).toHaveLength(2);
  });

  it('filters invoices by status', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-filter-status');
    const project = await createTestProject(company.id);
    await createTestInvoice(company.id, project.id, { invoiceNumber: 'INV-D1', status: 'draft' });
    await createTestInvoice(company.id, project.id, { invoiceNumber: 'INV-A1', status: 'approved' });

    const res = await get('/api/v1/invoices?status=draft', admin.accessToken);
    const { invoices } = JSON.parse(res.payload);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].status).toBe('draft');
  });

  it('filters invoices by vendorType', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-filter-vendor');
    const project = await createTestProject(company.id);
    await createTestInvoice(company.id, project.id, { invoiceNumber: 'INV-C1', vendorType: 'contractor' });
    await createTestInvoice(company.id, project.id, { invoiceNumber: 'INV-S1', vendorType: 'supplier' });

    const res = await get('/api/v1/invoices?vendorType=consultant', admin.accessToken);
    const { invoices } = JSON.parse(res.payload);
    expect(invoices).toHaveLength(0);
  });

  it('tenant isolation — cannot see other company invoices', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'inv-tenant1');
    const { company: c2, admin: a2 } = await createTestCompany(app, 'inv-tenant2');
    const p1 = await createTestProject(c1.id);
    const p2 = await createTestProject(c2.id);

    await createTestInvoice(c1.id, p1.id, { invoiceNumber: 'C1-INV' });
    await createTestInvoice(c2.id, p2.id, { invoiceNumber: 'C2-INV' });

    const res = await get('/api/v1/invoices', a1.accessToken);
    const { invoices } = JSON.parse(res.payload);
    expect(invoices).toHaveLength(1);
    expect(invoices[0].invoiceNumber).toBe('C1-INV');
  });

  it('can get invoice detail', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-detail');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, { invoiceNumber: 'INV-DETAIL' });

    const res = await get(`/api/v1/invoices/${inv.id}`, admin.accessToken);
    expect(res.statusCode).toBe(200);
    const { invoice } = JSON.parse(res.payload);
    expect(invoice.invoiceNumber).toBe('INV-DETAIL');
    expect(invoice.payments).toBeDefined();
    expect(invoice.lineItems).toBeDefined();
  });

  it('returns 404 for wrong company invoice', async () => {
    const { company: c1, admin: a1 } = await createTestCompany(app, 'inv-404-c1');
    const { company: c2 }            = await createTestCompany(app, 'inv-404-c2');
    const p2 = await createTestProject(c2.id);
    const inv = await createTestInvoice(c2.id, p2.id);

    const res = await get(`/api/v1/invoices/${inv.id}`, a1.accessToken);
    expect(res.statusCode).toBe(404);
  });

  it('admin can update draft invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-update');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, { invoiceNumber: 'INV-UPD' });

    const res = await patch(`/api/v1/invoices/${inv.id}`, {
      vendorName: 'Updated Vendor',
      notes:      'Updated notes',
    }, admin.accessToken);

    expect(res.statusCode).toBe(200);
    const { invoice } = JSON.parse(res.payload);
    expect(invoice.vendorName).toBe('Updated Vendor');
    expect(invoice.notes).toBe('Updated notes');
  });

  it('cannot update approved invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-no-edit-approved');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-APR',
      status:        'approved',
    });

    const res = await patch(`/api/v1/invoices/${inv.id}`, { vendorName: 'X' }, admin.accessToken);
    expect(res.statusCode).toBe(422);
  });

  it('finance_officer can delete draft invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-del');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, { invoiceNumber: 'INV-DEL' });

    const res = await del(`/api/v1/invoices/${inv.id}`, admin.accessToken);
    expect(res.statusCode).toBe(204);
  });

  it('cannot delete approved invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-no-del-apr');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-APR2',
      status:        'approved',
    });

    const res = await del(`/api/v1/invoices/${inv.id}`, admin.accessToken);
    expect(res.statusCode).toBe(422);
  });
});

describe('Invoices — Status Transitions', () => {
  it('admin can submit a draft invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-submit');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, { invoiceNumber: 'INV-SUB' });

    const res = await post(`/api/v1/invoices/${inv.id}/submit`, {}, admin.accessToken);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).invoice.status).toBe('submitted');
  });

  it('finance officer can approve a submitted invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-approve');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-APR3',
      status:        'submitted',
    });

    const res = await post(`/api/v1/invoices/${inv.id}/approve`, {}, admin.accessToken);
    expect(res.statusCode).toBe(200);
    const { invoice } = JSON.parse(res.payload);
    expect(invoice.status).toBe('approved');
    expect(invoice.approvedAt).not.toBeNull();
    expect(invoice.approvedBy).not.toBeNull();
  });

  it('project_manager cannot approve invoices', async () => {
    const { company } = await createTestCompany(app, 'inv-no-approve-pm');
    const project = await createTestProject(company.id);
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm1');
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-PM-APR',
      status:        'submitted',
    });

    const res = await post(`/api/v1/invoices/${inv.id}/approve`, {}, pm.accessToken);
    expect(res.statusCode).toBe(403);
  });

  it('finance officer can dispute an approved invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-dispute');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-DISP',
      status:        'approved',
    });

    const res = await post(`/api/v1/invoices/${inv.id}/dispute`, { notes: 'Amount mismatch' }, admin.accessToken);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).invoice.status).toBe('disputed');
  });

  it('finance officer can cancel an invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-cancel');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-CANCEL',
      status:        'approved',
    });

    const res = await post(`/api/v1/invoices/${inv.id}/cancel`, {}, admin.accessToken);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).invoice.status).toBe('cancelled');
  });
});

describe('Invoices — Line Items', () => {
  it('admin can add a line item to a draft invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-li-add');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, { invoiceNumber: 'INV-LI' });

    const res = await post(`/api/v1/invoices/${inv.id}/line-items`, {
      description: 'Labour — plasterers',
      quantity:    10,
      unitRate:    500,
      amount:      5000,
      notes:       'Week 1',
    }, admin.accessToken);

    expect(res.statusCode).toBe(201);
    const { invoice } = JSON.parse(res.payload);
    expect(invoice.lineItems).toHaveLength(1);
    expect(invoice.lineItems[0].description).toBe('Labour — plasterers');
  });

  it('admin can delete a line item from a draft invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-li-del');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, { invoiceNumber: 'INV-LI-DEL' });

    const addRes = await post(`/api/v1/invoices/${inv.id}/line-items`, {
      description: 'Materials',
      quantity:    5,
      unitRate:    1000,
      amount:      5000,
    }, admin.accessToken);
    const lineItemId = JSON.parse(addRes.payload).invoice.lineItems[0].id;

    const delRes = await del(`/api/v1/invoices/${inv.id}/line-items/${lineItemId}`, admin.accessToken);
    expect(delRes.statusCode).toBe(204);
  });

  it('cannot add line items to approved invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-li-no-add');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-LI-APR',
      status:        'approved',
    });

    const res = await post(`/api/v1/invoices/${inv.id}/line-items`, {
      description: 'Extra works',
      quantity: 1,
      unitRate: 500,
      amount: 500,
    }, admin.accessToken);
    expect(res.statusCode).toBe(422);
  });
});

describe('Invoices — Payments', () => {
  it('finance officer can record a full payment', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-pay-full');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-PAY',
      status:        'approved',
      totalAmount:   10000,
    });

    const res = await post(`/api/v1/invoices/${inv.id}/payments`, {
      amount:      10000,
      paymentDate: '2026-04-15',
      method:      'bank_transfer',
      reference:   'TXN-123',
      notes:       'Final payment',
    }, admin.accessToken);

    expect(res.statusCode).toBe(201);
    const { payment } = JSON.parse(res.payload);
    expect(Number(payment.amount)).toBe(10000);
    expect(payment.method).toBe('bank_transfer');
    expect(payment.recordedBy).not.toBeNull();

    // Invoice should now be marked as paid
    const detailRes = await get(`/api/v1/invoices/${inv.id}`, admin.accessToken);
    const { invoice } = JSON.parse(detailRes.payload);
    expect(invoice.status).toBe('paid');
    expect(Number(invoice.paidAmount)).toBe(10000);
    expect(invoice.paidAt).not.toBeNull();
  });

  it('records partial payment and sets status to partially_paid', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-pay-partial');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-PARTIAL',
      status:        'approved',
      totalAmount:   10000,
    });

    const res = await post(`/api/v1/invoices/${inv.id}/payments`, {
      amount:      4000,
      paymentDate: '2026-04-10',
      method:      'eft',
    }, admin.accessToken);

    expect(res.statusCode).toBe(201);

    const detailRes = await get(`/api/v1/invoices/${inv.id}`, admin.accessToken);
    const { invoice } = JSON.parse(detailRes.payload);
    expect(invoice.status).toBe('partially_paid');
    expect(Number(invoice.paidAmount)).toBe(4000);
  });

  it('supports multiple payment records', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-multi-pay');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-MULTI',
      status:        'approved',
      totalAmount:   10000,
    });

    await post(`/api/v1/invoices/${inv.id}/payments`, { amount: 3000, paymentDate: '2026-04-05', method: 'cash' }, admin.accessToken);
    await post(`/api/v1/invoices/${inv.id}/payments`, { amount: 3000, paymentDate: '2026-04-10', method: 'cash' }, admin.accessToken);
    await post(`/api/v1/invoices/${inv.id}/payments`, { amount: 4000, paymentDate: '2026-04-15', method: 'bank_transfer' }, admin.accessToken);

    const detailRes = await get(`/api/v1/invoices/${inv.id}`, admin.accessToken);
    const { invoice } = JSON.parse(detailRes.payload);
    expect(invoice.status).toBe('paid');
    expect(invoice.payments).toHaveLength(3);
    expect(Number(invoice.paidAmount)).toBe(10000);
  });

  it('rejects payment exceeding total amount', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-pay-exceed');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-EXCEED',
      status:        'approved',
      totalAmount:   5000,
    });

    const res = await post(`/api/v1/invoices/${inv.id}/payments`, {
      amount:      9999,
      paymentDate: '2026-04-10',
      method:      'cash',
    }, admin.accessToken);

    expect(res.statusCode).toBe(422);
  });

  it('cannot record payment for draft invoice', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-pay-draft');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-DRAFT-PAY',
      status:        'draft',
      totalAmount:   5000,
    });

    const res = await post(`/api/v1/invoices/${inv.id}/payments`, {
      amount:      1000,
      paymentDate: '2026-04-10',
      method:      'cash',
    }, admin.accessToken);

    expect(res.statusCode).toBe(422);
  });

  it('project_manager cannot record payments', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-pay-pm');
    const project = await createTestProject(company.id);
    const pm = await createTestUser(app, company.id, 'project_manager', 'pm2');
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-PM-PAY',
      status:        'approved',
      totalAmount:   5000,
    });

    const res = await post(`/api/v1/invoices/${inv.id}/payments`, {
      amount:      1000,
      paymentDate: '2026-04-10',
      method:      'cash',
    }, pm.accessToken);

    expect(res.statusCode).toBe(403);
  });

  it('finance officer can remove a payment and status reverts', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-pay-del');
    const project = await createTestProject(company.id);
    const inv = await createTestInvoice(company.id, project.id, {
      invoiceNumber: 'INV-PAY-DEL',
      status:        'approved',
      totalAmount:   5000,
    });

    const payRes = await post(`/api/v1/invoices/${inv.id}/payments`, {
      amount:      5000,
      paymentDate: '2026-04-10',
      method:      'eft',
    }, admin.accessToken);
    const { payment } = JSON.parse(payRes.payload);

    // Invoice is now paid — remove payment
    const delRes = await del(`/api/v1/invoices/${inv.id}/payments/${payment.id}`, admin.accessToken);
    expect(delRes.statusCode).toBe(204);

    const detailRes = await get(`/api/v1/invoices/${inv.id}`, admin.accessToken);
    const { invoice } = JSON.parse(detailRes.payload);
    expect(invoice.status).toBe('approved');
    expect(Number(invoice.paidAmount)).toBe(0);
  });
});

describe('Invoices — Budget link', () => {
  it('invoice can be linked to a budget line item', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-budget-link');
    const project = await createTestProject(company.id);
    const budget = await createTestBudget(company.id, project.id);
    const lineItem = await createTestLineItem(budget.id, company.id, project.id, {
      category:    'materials',
      description: 'Cement supplies',
      budgetedAmount: 20000,
    });

    const res = await post('/api/v1/invoices', {
      projectId:       project.id,
      invoiceNumber:   'INV-BLI',
      vendorType:      'supplier',
      vendorName:      'Cement Supplier',
      budgetLineItemId: lineItem.id,
      subtotal:        15000,
      taxAmount:       0,
      totalAmount:     15000,
      currency:        'USD',
      issueDate:       '2026-04-01',
      dueDate:         '2026-04-30',
    }, admin.accessToken);

    expect(res.statusCode).toBe(201);
    const { invoice } = JSON.parse(res.payload);
    expect(invoice.budgetLineItemId).toBe(lineItem.id);
    expect(invoice.budgetLineItem).not.toBeNull();
    expect(invoice.budgetLineItem.category).toBe('materials');
  });
});

describe('Invoices — Summary', () => {
  it('returns invoice summary stats', async () => {
    const { company, admin } = await createTestCompany(app, 'inv-summary');
    const project = await createTestProject(company.id);

    await createTestInvoice(company.id, project.id, { invoiceNumber: 'S1', status: 'approved', totalAmount: 10000 });
    await createTestInvoice(company.id, project.id, { invoiceNumber: 'S2', status: 'paid',     totalAmount: 5000 });
    await createTestInvoice(company.id, project.id, { invoiceNumber: 'S3', status: 'draft',    totalAmount: 2000 });

    const res = await get('/api/v1/invoices/summary', admin.accessToken);
    expect(res.statusCode).toBe(200);
    const { summary } = JSON.parse(res.payload);
    expect(summary.totalCount).toBe(3);
    expect(summary.totalValue).toBe(17000);
    expect(summary.byStatus.approved).toBeDefined();
    expect(summary.byStatus.paid).toBeDefined();
  });
});
