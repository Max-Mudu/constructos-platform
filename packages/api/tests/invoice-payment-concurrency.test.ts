/**
 * POST   /invoices/:invoiceId/payments
 * DELETE /invoices/:invoiceId/payments/:paymentId
 *
 * The paid amount of an invoice always equals the sum of its recorded payments
 * and never exceeds the invoice total, also when several payment requests for
 * the same invoice arrive at the same time. A payment that no longer fits is
 * refused with the usual 422 and writes nothing. Roles are unchanged: only
 * company_admin and finance_officer may record or remove payments.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestInvoice,
  assignUserToProject,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

let admin: TestUser;
let finance: TestUser;
let pm: TestUser;
let companyId: string;
let projectId: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'inv-pay-conc');
  companyId = a.company.id;
  admin = a.admin;

  const project = await createTestProject(companyId, 'P1');
  projectId = project.id;

  finance = await createTestUser(app, companyId, 'finance_officer', 'inv-pay-conc-fo', { canViewFinance: true });
  pm = await createTestUser(app, companyId, 'project_manager', 'inv-pay-conc-pm', { canViewFinance: true });
  await assignUserToProject(companyId, projectId, pm.id);

  // Open several pooled connections up front, so the requests of the very
  // first test already run side by side instead of queueing on one connection.
  await Promise.all(Array.from({ length: 8 }, () => prisma.$queryRaw`SELECT 1`));
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

function makeInvoice(totalAmount = 100, status: 'approved' | 'draft' | 'cancelled' = 'approved') {
  return createTestInvoice(companyId, projectId, {
    status,
    totalAmount,
    subtotal: totalAmount,
    dueDate: new Date('2099-12-31'),
  });
}

function pay(user: TestUser, invoiceId: string, amount: number) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/invoices/${invoiceId}/payments`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: { amount, paymentDate: '2026-04-10', method: 'bank_transfer' },
  });
}

function removePayment(user: TestUser, invoiceId: string, paymentId: string) {
  return app.inject({
    method: 'DELETE',
    url: `/api/v1/invoices/${invoiceId}/payments/${paymentId}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
  });
}

/** The stored invoice figures next to the sum of the payment rows that exist for it. */
async function ledger(invoiceId: string) {
  const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const payments = await prisma.invoicePayment.findMany({ where: { invoiceId } });
  return {
    status: invoice.status,
    paidAt: invoice.paidAt,
    paidAmount: Number(invoice.paidAmount),
    total: Number(invoice.totalAmount),
    paymentCount: payments.length,
    paymentSum: payments.reduce((sum, p) => sum + Number(p.amount), 0),
  };
}

function count(results: Array<{ statusCode: number }>, statusCode: number): number {
  return results.filter((r) => r.statusCode === statusCode).length;
}

// ─── Concurrent payments ──────────────────────────────────────────────────────

describe('concurrent payments on one invoice', () => {
  it('two payments that together exceed the total: one is recorded, one gets 422', async () => {
    const inv = await makeInvoice(100);

    const results = await Promise.all([pay(admin, inv.id, 60), pay(finance, inv.id, 60)]);

    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 422]);
    const refused = results.find((r) => r.statusCode === 422)!;
    expect(refused.json().error).toMatch(/would exceed total invoice amount/);

    const l = await ledger(inv.id);
    expect(l.paymentCount).toBe(1);
    expect(l.paymentSum).toBe(60);
    expect(l.paidAmount).toBe(60);
    expect(l.status).toBe('partially_paid');
  });

  it('many payments: only those that fit are recorded and the paid amount is their sum', async () => {
    const inv = await makeInvoice(100);

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => pay(i % 2 ? admin : finance, inv.id, 30)),
    );

    // floor(100 / 30) = 3 fit, 10 remains unpaid
    expect(count(results, 201)).toBe(3);
    expect(count(results, 422)).toBe(5);

    const l = await ledger(inv.id);
    expect(l.paymentCount).toBe(3);
    expect(l.paymentSum).toBe(90);
    expect(l.paidAmount).toBe(90);
    expect(l.paidAmount).toBeLessThanOrEqual(l.total);
    expect(l.status).toBe('partially_paid');
    expect(l.paidAt).toBeNull();
  });

  it('payments that exactly settle the invoice are all recorded and mark it paid', async () => {
    const inv = await makeInvoice(100);

    const results = await Promise.all(Array.from({ length: 5 }, () => pay(finance, inv.id, 20)));

    expect(results.map((r) => r.statusCode)).toEqual(Array(5).fill(201));

    const l = await ledger(inv.id);
    expect(l.paymentCount).toBe(5);
    expect(l.paymentSum).toBe(100);
    expect(l.paidAmount).toBe(100);
    expect(l.status).toBe('paid');
    expect(l.paidAt).not.toBeNull();
  });

  it('one audit row is written per recorded payment and none for a refused one', async () => {
    const inv = await makeInvoice(100);

    const results = await Promise.all(Array.from({ length: 4 }, () => pay(admin, inv.id, 40)));

    expect(count(results, 201)).toBe(2);
    expect(count(results, 422)).toBe(2);
    const rows = await prisma.auditLog.findMany({ where: { entityType: 'Invoice', entityId: inv.id } });
    expect(rows).toHaveLength(2);
  });
});

// ─── Concurrent removals ──────────────────────────────────────────────────────

describe('concurrent removal of payments', () => {
  async function invoiceWithPayments(amounts: number[], total = 100) {
    const inv = await makeInvoice(total);
    const ids: string[] = [];
    for (const amount of amounts) {
      const res = await pay(admin, inv.id, amount);
      expect(res.statusCode).toBe(201);
      ids.push(res.json().payment.id);
    }
    return { inv, ids };
  }

  it('removing every payment at the same time leaves nothing paid', async () => {
    const { inv, ids } = await invoiceWithPayments([25, 25, 25, 25]);
    expect((await ledger(inv.id)).status).toBe('paid');

    const results = await Promise.all(ids.map((id, i) => removePayment(i % 2 ? admin : finance, inv.id, id)));

    expect(results.map((r) => r.statusCode)).toEqual([204, 204, 204, 204]);
    const l = await ledger(inv.id);
    expect(l.paymentCount).toBe(0);
    expect(l.paidAmount).toBe(0);
    expect(l.status).toBe('approved');
    expect(l.paidAt).toBeNull();
  });

  it('removing some payments at the same time leaves the sum of the rest', async () => {
    const { inv, ids } = await invoiceWithPayments([10, 20, 30, 40]);

    const results = await Promise.all(ids.slice(0, 3).map((id) => removePayment(finance, inv.id, id)));

    expect(results.map((r) => r.statusCode)).toEqual([204, 204, 204]);
    const l = await ledger(inv.id);
    expect(l.paymentCount).toBe(1);
    expect(l.paymentSum).toBe(40);
    expect(l.paidAmount).toBe(40);
    expect(l.status).toBe('partially_paid');
  });

  it('the same payment removed by several requests is removed once', async () => {
    const { inv, ids } = await invoiceWithPayments([30, 30]);

    const results = await Promise.all(Array.from({ length: 5 }, () => removePayment(admin, inv.id, ids[0]!)));

    expect(count(results, 204)).toBe(1);
    expect(count(results, 404)).toBe(4);
    const l = await ledger(inv.id);
    expect(l.paymentCount).toBe(1);
    expect(l.paidAmount).toBe(30);
    expect(l.status).toBe('partially_paid');
  });

  it('payments and removals at the same time keep the paid amount equal to the payments that remain', async () => {
    const { inv, ids } = await invoiceWithPayments([20, 20]);

    const results = await Promise.all([
      removePayment(admin, inv.id, ids[0]!),
      pay(finance, inv.id, 30),
      removePayment(finance, inv.id, ids[1]!),
      pay(admin, inv.id, 30),
    ]);

    // 40 is paid before; whichever order the requests are applied in, both
    // new payments fit (at most 40 + 30 + 30 = 100) and both removals succeed.
    expect(results.map((r) => r.statusCode)).toEqual([204, 201, 204, 201]);
    const l = await ledger(inv.id);
    expect(l.paymentCount).toBe(2);
    expect(l.paymentSum).toBe(60);
    expect(l.paidAmount).toBe(60);
    expect(l.status).toBe('partially_paid');
  });
});

// ─── Single-request behaviour (unchanged) ─────────────────────────────────────

describe('single requests', () => {
  it('a payment is returned with its stored fields and updates the invoice', async () => {
    const inv = await makeInvoice(100);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${inv.id}/payments`,
      headers: { authorization: `Bearer ${finance.accessToken}` },
      payload: { amount: 40, paymentDate: '2026-04-10', method: 'eft', reference: 'TXN-1', notes: 'first' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().payment).toMatchObject({
      invoiceId: inv.id,
      companyId,
      currency: 'USD',
      method: 'eft',
      reference: 'TXN-1',
      notes: 'first',
      recordedById: finance.id,
    });
    expect(Number(res.json().payment.amount)).toBe(40);

    const l = await ledger(inv.id);
    expect(l.paidAmount).toBe(40);
    expect(l.status).toBe('partially_paid');
  });

  it('a payment above the remaining balance gets 422 and writes nothing', async () => {
    const inv = await makeInvoice(100);
    expect((await pay(admin, inv.id, 70)).statusCode).toBe(201);

    const res = await pay(admin, inv.id, 31);

    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('Payment of 31 would exceed total invoice amount of 100');
    const l = await ledger(inv.id);
    expect(l.paymentCount).toBe(1);
    expect(l.paidAmount).toBe(70);
  });

  it('a payment on a draft or cancelled invoice gets 422 and writes nothing', async () => {
    for (const status of ['draft', 'cancelled'] as const) {
      const inv = await makeInvoice(100, status);
      const res = await pay(admin, inv.id, 10);
      expect(res.statusCode).toBe(422);
      expect(res.json().error).toMatch(/Payments can only be recorded for approved/);
      const l = await ledger(inv.id);
      expect(l.paymentCount).toBe(0);
      expect(l.paidAmount).toBe(0);
      expect(l.status).toBe(status);
    }
  });

  it('a zero or negative amount is refused', async () => {
    const inv = await makeInvoice(100);
    expect((await pay(admin, inv.id, -5)).statusCode).toBe(422);
    expect((await ledger(inv.id)).paymentCount).toBe(0);
  });

  it('a fully paid invoice accepts no further payment', async () => {
    const inv = await makeInvoice(100);
    expect((await pay(admin, inv.id, 100)).statusCode).toBe(201);

    const res = await pay(admin, inv.id, 1);

    expect(res.statusCode).toBe(422);
    const l = await ledger(inv.id);
    expect(l.paidAmount).toBe(100);
    expect(l.status).toBe('paid');
  });

  it('removing the only payment returns the invoice to approved', async () => {
    const inv = await makeInvoice(100);
    const paid = await pay(admin, inv.id, 100);

    const res = await removePayment(finance, inv.id, paid.json().payment.id);

    expect(res.statusCode).toBe(204);
    const l = await ledger(inv.id);
    expect(l.paidAmount).toBe(0);
    expect(l.status).toBe('approved');
    expect(l.paidAt).toBeNull();
  });

  it('removing a payment that does not exist is a 404', async () => {
    const inv = await makeInvoice(100);
    const res = await removePayment(admin, inv.id, '00000000-0000-4000-8000-000000000000');
    expect(res.statusCode).toBe(404);
  });

  it('a project manager can neither record nor remove a payment', async () => {
    const inv = await makeInvoice(100);
    const paid = await pay(admin, inv.id, 10);

    expect((await pay(pm, inv.id, 10)).statusCode).toBe(403);
    expect((await removePayment(pm, inv.id, paid.json().payment.id)).statusCode).toBe(403);

    const l = await ledger(inv.id);
    expect(l.paymentCount).toBe(1);
    expect(l.paidAmount).toBe(10);
  });
});
