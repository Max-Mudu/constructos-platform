/**
 * Budget rule approved by the owner on 18 Nov 2026.
 *
 * Variation orders: only finance staff (company_admin, finance_officer) decide
 * a variation. Once it is decided (approved or rejected), the requesting
 * project manager can no longer change it - neither its amount or details
 * nor its status - so an approved amount always carries an approval. While it
 * is pending the requester can still edit it, and finance staff can still
 * act on decided variations. A refused edit leaves the row unchanged.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany, createTestUser, createTestProject, assignUserToProject,
  createTestBudget, clearDatabase, TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;
let admin: TestUser; let fo: TestUser; let pm: TestUser;
let budgetId: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();
  const a = await createTestCompany(app, 'variation-decided');
  const cid = a.company.id;
  admin = a.admin;
  fo = await createTestUser(app, cid, 'finance_officer', 'vd-fo', { canViewFinance: true });
  pm = await createTestUser(app, cid, 'project_manager', 'vd-pm', { canViewFinance: true });
  const project = await createTestProject(cid, 'VD-P');
  await assignUserToProject(cid, project.id, pm.id);
  budgetId = (await createTestBudget(cid, project.id)).id;
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

function patch(user: TestUser, variationId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/budgets/${budgetId}/variations/${variationId}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload,
  });
}

async function requestVariation(ref: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/budgets/${budgetId}/variations`,
    headers: { authorization: `Bearer ${pm.accessToken}` },
    payload: { referenceNumber: ref, description: 'extra work', amount: 100 },
  });
  expect(res.statusCode).toBe(201);
  return res.json().variation.id;
}

const row = (id: string) => prisma.variationOrder.findUniqueOrThrow({ where: { id } });

describe('PATCH /budgets/:budgetId/variations/:variationId after a decision', () => {
  it('requester edits a pending variation', async () => {
    const id = await requestVariation('VD-1');
    const res = await patch(pm, id, { amount: 150, description: 'revised' });
    expect(res.statusCode).toBe(200);
    expect(Number((await row(id)).amount)).toBe(150);
  });

  it.each(['approved', 'rejected'])('requester cannot change the amount of a %s variation (403, unchanged)', async (status) => {
    const id = await requestVariation(`VD-amt-${status}`);
    expect((await patch(fo, id, { status })).statusCode).toBe(200);
    const res = await patch(pm, id, { amount: 999999 });
    expect(res.statusCode).toBe(403);
    const after = await row(id);
    expect(Number(after.amount)).toBe(100);
    expect(after.status).toBe(status);
  });

  it('requester cannot reset an approved variation to pending (403, unchanged)', async () => {
    const id = await requestVariation('VD-reset');
    expect((await patch(fo, id, { status: 'approved' })).statusCode).toBe(200);
    const res = await patch(pm, id, { status: 'pending' });
    expect(res.statusCode).toBe(403);
    expect((await row(id)).status).toBe('approved');
  });

  it.each([
    ['finance_officer', () => fo],
    ['company_admin', () => admin],
  ])('%s can still change a decided variation', async (_label, who) => {
    const id = await requestVariation(`VD-fin-${_label}`);
    expect((await patch(fo, id, { status: 'approved' })).statusCode).toBe(200);
    const res = await patch(who(), id, { amount: 120 });
    expect(res.statusCode).toBe(200);
    expect(Number((await row(id)).amount)).toBe(120);
  });

  it.each([
    ['finance_officer', () => fo],
    ['company_admin', () => admin],
  ])('%s still approves and rejects pending variations and can reverse a decision', async (_label, who) => {
    const approved = await requestVariation(`VD-ok-${_label}`);
    const first = await patch(who(), approved, { status: 'approved' });
    expect(first.statusCode).toBe(200);
    expect((await row(approved)).approvedById).toBe(who().id);

    const rejected = await requestVariation(`VD-no-${_label}`);
    expect((await patch(who(), rejected, { status: 'rejected' })).statusCode).toBe(200);
    expect((await row(rejected)).status).toBe('rejected');

    expect((await patch(who(), approved, { status: 'rejected' })).statusCode).toBe(200);
    expect((await row(approved)).status).toBe('rejected');
  });

  it('requester still cannot approve their own pending variation (existing rule)', async () => {
    const id = await requestVariation('VD-self');
    const res = await patch(pm, id, { status: 'approved' });
    expect(res.statusCode).toBe(403);
    expect((await row(id)).status).toBe('pending');
  });
});
