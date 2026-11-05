/**
 * Invoice link-ID security: never trust a supplied ID.
 *
 * createInvoice / updateInvoice accept many foreign keys. Each must be
 * validated before anything is written:
 *  - contractorId, supplierId, consultantUserId → same company
 *  - siteId, budgetLineItemId, variationOrderId, deliveryRecordId,
 *    labourEntryId, marketingBudgetEntryId, consultantCostEntryId
 *    → same company AND the invoice's project
 * A failing ID returns the generic 404 for that entity (identical body for a
 * foreign ID and a nonexistent one), nothing is persisted, and the response
 * never echoes the foreign record.
 */
import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestWorker,
  createTestLabourEntry,
  createTestContractor,
  createTestSupplier,
  createTestDelivery,
  createTestBudget,
  createTestLineItem,
  createTestInvoice,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

type LinkField =
  | 'siteId' | 'contractorId' | 'supplierId' | 'consultantUserId'
  | 'budgetLineItemId' | 'variationOrderId' | 'deliveryRecordId' | 'labourEntryId'
  | 'marketingBudgetEntryId' | 'consultantCostEntryId';

type LinkSet = Record<LinkField, string>;

const COMPANY_LEVEL: LinkField[] = ['contractorId', 'supplierId', 'consultantUserId'];
const PROJECT_LEVEL: LinkField[] = [
  'siteId', 'budgetLineItemId', 'variationOrderId', 'deliveryRecordId', 'labourEntryId',
  'marketingBudgetEntryId', 'consultantCostEntryId',
];
const ALL_LINKS: LinkField[] = [...COMPANY_LEVEL, ...PROJECT_LEVEL];

// Distinctive markers stored on the foreign (company B) records.
const FOREIGN_MARK   = 'FOREIGN-ZZ';
const FOREIGN_AMOUNT = 777777;

let admin: TestUser;
let fo: TestUser;
let p1: string;
let validP1: LinkSet;   // company A, project P1
let otherP2: LinkSet;   // company A, project P2 (only project-level fields matter)
let foreign: LinkSet;   // company B

/** Builds one full set of linkable records for a project. */
async function seedLinks(companyId: string, projectId: string, userId: string, mark: string, amount: number): Promise<LinkSet> {
  const site       = await createTestSite(companyId, projectId, `${mark} site`);
  const contractor = await createTestContractor(companyId, `${mark} contractor`);
  const supplier   = await createTestSupplier(companyId, { name: `${mark} supplier` });
  const consultant = await prisma.user.create({
    data: {
      companyId, email: `cons-${randomUUID()}@test.com`, passwordHash: 'x',
      firstName: `${mark} consultant`, lastName: 'User', role: 'consultant',
    },
  });
  const budget = await prisma.budget.findUnique({ where: { projectId } })
    ?? await createTestBudget(companyId, projectId, { name: `${mark} budget` });
  const li = await createTestLineItem(budget.id, companyId, projectId, {
    description: `${mark} line`, budgetedAmount: amount,
  });
  const vo = await prisma.variationOrder.create({
    data: {
      budgetId: budget.id, companyId, projectId, referenceNumber: `${mark}-VO-${randomUUID().slice(0, 6)}`,
      description: `${mark} variation`, amount, requestedById: userId,
    },
  });
  const delivery = await createTestDelivery(companyId, projectId, site.id, userId, { itemDescription: `${mark} delivery` });
  const worker   = await createTestWorker(companyId, { firstName: `${mark} worker` });
  const labour   = await createTestLabourEntry(companyId, projectId, site.id, worker.id, userId, { dailyRate: amount });
  const mktLine  = await createTestLineItem(budget.id, companyId, projectId, { category: 'marketing', description: `${mark} mkt line` });
  const mkt = await prisma.marketingBudgetEntry.create({
    data: { budgetLineItemId: mktLine.id, companyId, projectId, campaignName: `${mark} campaign`, channel: 'web', budgetedAmount: amount },
  });
  const ccLine = await createTestLineItem(budget.id, companyId, projectId, { category: 'consultants', description: `${mark} cc line` });
  const cc = await prisma.consultantCostEntry.create({
    data: { budgetLineItemId: ccLine.id, companyId, projectId, consultantType: 'engineer', consultantName: `${mark} consultant cost`, feeAgreed: amount },
  });
  return {
    siteId: site.id, contractorId: contractor.id, supplierId: supplier.id, consultantUserId: consultant.id,
    budgetLineItemId: li.id, variationOrderId: vo.id, deliveryRecordId: delivery.id, labourEntryId: labour.id,
    marketingBudgetEntryId: mkt.id, consultantCostEntryId: cc.id,
  };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'invlink-a');
  const b = await createTestCompany(app, 'invlink-b');
  admin = a.admin;
  fo    = await createTestUser(app, a.company.id, 'finance_officer', 'invlink-fo', { canViewFinance: true });

  const projA1 = await createTestProject(a.company.id, 'Link P1');
  const projA2 = await createTestProject(a.company.id, 'Link P2');
  const projB  = await createTestProject(b.company.id, 'Link PB');
  p1 = projA1.id;

  validP1 = await seedLinks(a.company.id, projA1.id, admin.id, 'VALID-P1', 100);
  otherP2 = await seedLinks(a.company.id, projA2.id, admin.id, 'OTHER-P2', 200);
  foreign = await seedLinks(b.company.id, projB.id, b.admin.id, FOREIGN_MARK, FOREIGN_AMOUNT);
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

let seq = 0;
function createBody(extra: Record<string, string | null>) {
  return {
    projectId:     p1,
    invoiceNumber: `LINK-${++seq}-${Date.now()}`,
    vendorName:    'Link Vendor',
    vendorType:    'supplier',
    issueDate:     '2026-11-01',
    dueDate:       '2027-12-01',
    subtotal:      10,
    totalAmount:   10,
    ...extra,
  };
}

function send(method: 'POST' | 'PATCH', url: string, user: TestUser, payload: object) {
  return app.inject({ method, url, payload, headers: { authorization: `Bearer ${user.accessToken}` } });
}

function expectNoForeignLeak(body: string) {
  expect(body).not.toContain(FOREIGN_MARK);
  expect(body).not.toContain(String(FOREIGN_AMOUNT));
}

async function linkColumns(invoiceId: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const out: Record<string, string | null> = {};
  for (const f of ALL_LINKS) out[f] = inv[f];
  return out;
}

// ─── Create ──────────────────────────────────────────────────────────────────

describe('POST /invoices — link validation', () => {
  it.each(ALL_LINKS)('foreign-company %s → 404, nothing created, nothing leaked', async (field) => {
    const body = createBody({ [field]: foreign[field] });
    const res  = await send('POST', '/api/v1/invoices', admin, body);
    expect(res.statusCode).toBe(404);
    expectNoForeignLeak(res.payload);
    expect(await prisma.invoice.count({ where: { invoiceNumber: body.invoiceNumber } })).toBe(0);
  });

  it.each(PROJECT_LEVEL)('same-company other-project %s → 404, nothing created', async (field) => {
    const body = createBody({ [field]: otherP2[field] });
    const res  = await send('POST', '/api/v1/invoices', fo, body);
    expect(res.statusCode).toBe(404);
    expect(res.payload).not.toContain('OTHER-P2');
    expect(await prisma.invoice.count({ where: { invoiceNumber: body.invoiceNumber } })).toBe(0);
  });

  it.each(ALL_LINKS)('foreign %s gives exactly the same 404 body as a nonexistent id', async (field) => {
    const foreignRes = await send('POST', '/api/v1/invoices', admin, createBody({ [field]: foreign[field] }));
    const missingRes = await send('POST', '/api/v1/invoices', admin, createBody({ [field]: randomUUID() }));
    expect(foreignRes.statusCode).toBe(404);
    expect(missingRes.statusCode).toBe(404);
    expect(foreignRes.json()).toEqual(missingRes.json());
  });

  it('one bad link among valid ones still rejects the whole create', async () => {
    const body = createBody({ ...validP1, labourEntryId: foreign.labourEntryId });
    const res  = await send('POST', '/api/v1/invoices', admin, body);
    expect(res.statusCode).toBe(404);
    expect(await prisma.invoice.count({ where: { invoiceNumber: body.invoiceNumber } })).toBe(0);
  });

  it('valid same-company / same-project links still work', async () => {
    const res = await send('POST', '/api/v1/invoices', admin, createBody(validP1));
    expect(res.statusCode).toBe(201);
    const { invoice } = res.json();
    for (const f of ALL_LINKS) expect(invoice[f]).toBe(validP1[f]);
    expect(invoice.contractor.name).toBe('VALID-P1 contractor');
    expectNoForeignLeak(res.payload);
  });
});

// ─── Update ──────────────────────────────────────────────────────────────────

describe('PATCH /invoices/:id — link validation', () => {
  it.each(ALL_LINKS)('foreign-company %s → 404 and invoice unchanged', async (field) => {
    const inv    = await createTestInvoice(admin.companyId, p1, { invoiceNumber: `LINK-U-${++seq}` });
    const before = await linkColumns(inv.id);
    const res    = await send('PATCH', `/api/v1/invoices/${inv.id}`, admin, { [field]: foreign[field], notes: 'should not persist' });
    expect(res.statusCode).toBe(404);
    expectNoForeignLeak(res.payload);
    expect(await linkColumns(inv.id)).toEqual(before);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).notes).toBeNull();
  });

  it.each(PROJECT_LEVEL)('same-company other-project %s → 404 and invoice unchanged', async (field) => {
    const inv    = await createTestInvoice(admin.companyId, p1, { invoiceNumber: `LINK-U-${++seq}` });
    const before = await linkColumns(inv.id);
    const res    = await send('PATCH', `/api/v1/invoices/${inv.id}`, fo, { [field]: otherP2[field] });
    expect(res.statusCode).toBe(404);
    expect(await linkColumns(inv.id)).toEqual(before);
  });

  it('valid links can be set, and links can still be cleared with null', async () => {
    const inv = await createTestInvoice(admin.companyId, p1, { invoiceNumber: `LINK-U-${++seq}` });
    const set = await send('PATCH', `/api/v1/invoices/${inv.id}`, admin, validP1);
    expect(set.statusCode).toBe(200);
    for (const f of ALL_LINKS) expect(set.json().invoice[f]).toBe(validP1[f]);

    const clear = await send('PATCH', `/api/v1/invoices/${inv.id}`, admin,
      ALL_LINKS.reduce<Record<string, null>>((acc, f) => { acc[f] = null; return acc; }, {}));
    expect(clear.statusCode).toBe(200);
    for (const f of ALL_LINKS) expect(clear.json().invoice[f]).toBeNull();
  });
});
