/**
 * Invoice status integrity.
 *
 * 1. The overdue sweep (run when invoices are listed) marks only invoices that
 *    were approved, or partially paid, as overdue. A draft or submitted invoice
 *    past its due date keeps its status, so it does not become payable without
 *    an approval. An invoice already marked overdue is left as it is.
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
