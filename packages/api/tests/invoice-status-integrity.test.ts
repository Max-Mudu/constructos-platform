/**
 * Invoice status integrity.
 *
 * 1. The overdue sweep (run when invoices are listed) marks only invoices that
 *    were approved, or partially paid, as overdue. A draft or submitted invoice
 *    past its due date keeps its status, so it does not become payable without
 *    an approval. An invoice already marked overdue is left as it is.
 * 2. Removing a payment from a cancelled or disputed invoice corrects the paid
 *    amount and keeps the status: a cancelled invoice stays cancelled and a
 *    dispute is not ended. Other invoices behave as before.
 * Roles are unchanged: approving, recording and removing payments stay with
 * company_admin and finance_officer. Every change still writes its audit row.
 */
import { FastifyInstance } from 'fastify';
import { InvoiceStatus } from '@prisma/client';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestInvoice,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;
let admin: TestUser;
let finance: TestUser;
let companyId: string;
let projectId: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await clearDatabase();
  const a = await createTestCompany(app, 'inv-integrity');
  companyId = a.company.id;
  admin = a.admin;
  projectId = (await createTestProject(companyId, 'P1')).id;
  finance = await createTestUser(app, companyId, 'finance_officer', 'inv-integrity-fo', { canViewFinance: true });
});

function req(user: TestUser, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method,
    url: `/api/v1/invoices${url}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    ...(payload && { payload }),
  });
}

const PAST   = new Date('2026-01-15');
const FUTURE = new Date('2099-12-31');

async function invoice(status: InvoiceStatus, dueDate: Date, totalAmount = 1000) {
  return (await createTestInvoice(companyId, projectId, { status, dueDate, totalAmount, subtotal: totalAmount })).id;
}

async function statusOf(id: string) {
  return (await prisma.invoice.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
}

async function sweep() {
  const res = await req(finance, 'GET', '');
  expect(res.statusCode).toBe(200);
}

const pay = (id: string, amount: number) =>
  req(finance, 'POST', `/${id}/payments`, { amount, paymentDate: '2026-02-01', method: 'bank_transfer' });

// ─── 1. Overdue sweep ─────────────────────────────────────────────────────────

describe('overdue sweep', () => {
  it.each(['draft', 'submitted'] as const)('a %s invoice past its due date keeps its status and cannot be paid', async (status) => {
    const id = await invoice(status, PAST);
    await sweep();
    expect(await statusOf(id)).toBe(status);
    const res = await pay(id, 100);
    expect(res.statusCode).toBe(422);
    expect(await prisma.invoicePayment.count({ where: { invoiceId: id } })).toBe(0);
  });

  it('an approved invoice past its due date becomes overdue (unchanged)', async () => {
    const id = await invoice('approved', PAST);
    await sweep();
    expect(await statusOf(id)).toBe('overdue');
  });

  it('a partially paid invoice past its due date becomes overdue (unchanged)', async () => {
    const id = await invoice('approved', FUTURE);
    expect((await pay(id, 100)).statusCode).toBe(201);
    await prisma.invoice.update({ where: { id }, data: { dueDate: PAST } });
    expect(await statusOf(id)).toBe('partially_paid');
    await sweep();
    expect(await statusOf(id)).toBe('overdue');
  });

  it.each(['paid', 'disputed', 'cancelled'] as const)('a %s invoice past its due date is not swept (unchanged)', async (status) => {
    const id = await invoice(status, PAST);
    await sweep();
    expect(await statusOf(id)).toBe(status);
  });

  it('an invoice not yet due is not swept', async () => {
    const id = await invoice('approved', FUTURE);
    await sweep();
    expect(await statusOf(id)).toBe('approved');
  });

  it('a submitted invoice past its due date becomes overdue once a finance user approves it', async () => {
    const id = await invoice('submitted', PAST);
    await sweep();
    expect((await req(finance, 'POST', `/${id}/approve`)).statusCode).toBe(200);
    await sweep();
    expect(await statusOf(id)).toBe('overdue');
  });

  it('an invoice already marked overdue without an approval is left as it is', async () => {
    const id = await invoice('overdue', PAST);
    await sweep();
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('overdue');
    expect(row.approvedAt).toBeNull();
  });
});

// ─── 2. Removing a payment ────────────────────────────────────────────────────

describe('removing a payment', () => {
  async function paidThen(action: 'cancel' | 'dispute' | null, amount = 400) {
    const id = await invoice('approved', FUTURE);
    const res = await pay(id, amount);
    expect(res.statusCode).toBe(201);
    const paymentId = res.json().payment.id as string;
    if (action === 'cancel')  expect((await req(finance, 'POST', `/${id}/cancel`)).statusCode).toBe(200);
    if (action === 'dispute') expect((await req(finance, 'POST', `/${id}/dispute`, { notes: 'Wrong quantity' })).statusCode).toBe(200);
    return { id, paymentId };
  }

  it.each([['cancel', 'cancelled'], ['dispute', 'disputed']] as const)(
    'after %s, removing the payment keeps the invoice %s and corrects the paid amount (audit row written)',
    async (action, expected) => {
      const { id, paymentId } = await paidThen(action);
      const auditBefore = await prisma.auditLog.count({ where: { entityType: 'Invoice', entityId: id } });

      const res = await req(finance, 'DELETE', `/${id}/payments/${paymentId}`);
      expect(res.statusCode).toBe(204);

      const row = await prisma.invoice.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe(expected);
      expect(Number(row.paidAmount)).toBe(0);
      expect(await prisma.invoicePayment.count({ where: { invoiceId: id } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { entityType: 'Invoice', entityId: id } })).toBe(auditBefore + 1);
    },
  );

  it('a cancelled invoice stays cancelled and cannot take a new payment afterwards', async () => {
    const { id, paymentId } = await paidThen('cancel');
    await req(admin, 'DELETE', `/${id}/payments/${paymentId}`);
    expect(await statusOf(id)).toBe('cancelled');
    expect((await pay(id, 100)).statusCode).toBe(422);
  });

  it('removing one of two payments on a cancelled invoice keeps it cancelled with the remaining amount', async () => {
    const id = await invoice('approved', FUTURE);
    const first = (await pay(id, 300)).json().payment.id as string;
    expect((await pay(id, 200)).statusCode).toBe(201);
    expect((await req(finance, 'POST', `/${id}/cancel`)).statusCode).toBe(200);
    expect((await req(finance, 'DELETE', `/${id}/payments/${first}`)).statusCode).toBe(204);
    const row = await prisma.invoice.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('cancelled');
    expect(Number(row.paidAmount)).toBe(200);
  });

  it('on an approved invoice, removing the only payment returns it to approved (unchanged)', async () => {
    const { id, paymentId } = await paidThen(null);
    expect(await statusOf(id)).toBe('partially_paid');
    expect((await req(finance, 'DELETE', `/${id}/payments/${paymentId}`)).statusCode).toBe(204);
    expect(await statusOf(id)).toBe('approved');
  });

  it('on a paid invoice, removing a payment returns it to partially paid (unchanged)', async () => {
    const id = await invoice('approved', FUTURE);
    const a = (await pay(id, 600)).json().payment.id as string;
    expect((await pay(id, 400)).statusCode).toBe(201);
    expect(await statusOf(id)).toBe('paid');
    expect((await req(finance, 'DELETE', `/${id}/payments/${a}`)).statusCode).toBe(204);
    expect(await statusOf(id)).toBe('partially_paid');
  });
});
