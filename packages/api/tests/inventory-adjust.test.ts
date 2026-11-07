/**
 * POST /projects/:projectId/sites/:siteId/inventory/:inventoryId/adjust
 *
 * Stock adjustments: in/out with a reason, recorded as adjustment_in /
 * adjustment_out transactions with an audit row. Stock never goes negative,
 * even under concurrent requests. Roles: company_admin and project_manager.
 * Tenant and site isolation match the /use route.
 */
import { FastifyInstance } from 'fastify';
import { UserRole } from '@prisma/client';
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

interface World {
  admin: TestUser;
  pm: TestUser;
  outsiderPm: TestUser;        // company A, not a member of P1
  foreignAdmin: TestUser;      // company B
  companyId: string;
  p1: string; s1: string;
  p2: string; x: string;       // same company, other project
  q: string;  y: string;       // other company
  others: Record<string, TestUser>;
}

let w: World;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'adj-a');
  const b = await createTestCompany(app, 'adj-b');
  const cid = a.company.id;

  const p1 = await createTestProject(cid, 'P1');
  const s1 = await createTestSite(cid, p1.id, 'S1');
  const p2 = await createTestProject(cid, 'P2');
  const x  = await createTestSite(cid, p2.id, 'X');
  const q  = await createTestProject(b.company.id, 'Q');
  const y  = await createTestSite(b.company.id, q.id, 'Y');

  const pm         = await createTestUser(app, cid, 'project_manager', 'adj-pm');
  const outsiderPm = await createTestUser(app, cid, 'project_manager', 'adj-out');
  await assignUserToProject(cid, p1.id, pm.id);
  await assignUserToProject(cid, p2.id, outsiderPm.id);

  const others: Record<string, TestUser> = {};
  for (const role of ['site_supervisor', 'finance_officer', 'consultant', 'contractor', 'worker', 'viewer'] as UserRole[]) {
    const u = await createTestUser(app, cid, role, `adj-${role}`, { canViewFinance: role === 'finance_officer' });
    if (role !== 'finance_officer') await assignUserToProject(cid, p1.id, u.id, role === 'site_supervisor' ? s1.id : undefined);
    others[role] = u;
  }

  w = {
    admin: a.admin, pm, outsiderPm, foreignAdmin: b.admin, companyId: cid,
    p1: p1.id, s1: s1.id, p2: p2.id, x: x.id, q: q.id, y: y.id, others,
  };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

async function makeItem(siteId = w.s1, companyId = w.companyId, qty = 10, threshold: number | null = null) {
  return prisma.siteInventory.create({
    data: {
      companyId, siteId,
      materialName: `Cement-${Math.random().toString(36).slice(2, 8)}`,
      unitOfMeasure: 'bags',
      currentQuantity: qty,
      lowStockThreshold: threshold,
    },
  });
}

function adjust(user: TestUser, inventoryId: string, body: unknown, projectId = w.p1, siteId = w.s1) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/sites/${siteId}/inventory/${inventoryId}/adjust`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: body as Record<string, unknown>,
  });
}

async function stockOf(id: string): Promise<number> {
  const row = await prisma.siteInventory.findUniqueOrThrow({ where: { id } });
  return Number(row.currentQuantity);
}

// ─── Happy paths ──────────────────────────────────────────────────────────────

describe('adjust in / out', () => {
  it('in increases stock and records an adjustment_in transaction', async () => {
    const item = await makeItem();
    const res = await adjust(w.pm, item.id, { direction: 'in', quantity: 2.5, reason: 'found', note: 'Found behind store' });
    expect(res.statusCode).toBe(200);
    expect(Number(res.json().item.currentQuantity)).toBe(12.5);
    expect(await stockOf(item.id)).toBe(12.5);

    const txs = await prisma.inventoryTransaction.findMany({ where: { inventoryId: item.id } });
    expect(txs).toHaveLength(1);
    expect(txs[0]!.type).toBe('adjustment_in');
    expect(Number(txs[0]!.quantity)).toBe(2.5);
    expect(txs[0]!.usageReason).toBe('found');
    expect(txs[0]!.note).toBe('Found behind store');
    expect(txs[0]!.performedById).toBe(w.pm.id);
    expect(txs[0]!.companyId).toBe(w.companyId);
    expect(txs[0]!.siteId).toBe(w.s1);
  });

  it('out decreases stock and records a negative adjustment_out transaction', async () => {
    const item = await makeItem();
    const res = await adjust(w.admin, item.id, { direction: 'out', quantity: 4, reason: 'damaged' });
    expect(res.statusCode).toBe(200);
    expect(await stockOf(item.id)).toBe(6);

    const txs = await prisma.inventoryTransaction.findMany({ where: { inventoryId: item.id } });
    expect(txs).toHaveLength(1);
    expect(txs[0]!.type).toBe('adjustment_out');
    expect(Number(txs[0]!.quantity)).toBe(-4);
    expect(txs[0]!.usageReason).toBe('damaged');
    expect(txs[0]!.note).toBeNull();
    expect(txs[0]!.performedById).toBe(w.admin.id);
  });

  it('out equal to the full stock takes it to exactly zero', async () => {
    const item = await makeItem();
    const res = await adjust(w.pm, item.id, { direction: 'out', quantity: 10, reason: 'lost_or_stolen' });
    expect(res.statusCode).toBe(200);
    expect(await stockOf(item.id)).toBe(0);
  });

  it('adjustments appear in the item history', async () => {
    const item = await makeItem();
    await adjust(w.pm, item.id, { direction: 'in', quantity: 1, reason: 'stock_count_correction' });
    await adjust(w.pm, item.id, { direction: 'out', quantity: 3, reason: 'other', note: 'Lent to S2' });
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${w.p1}/sites/${w.s1}/inventory/${item.id}`,
      headers: { authorization: `Bearer ${w.pm.accessToken}` },
    });
    expect(res.statusCode).toBe(200);
    const txs = res.json().item.transactions as Array<{ type: string; usageReason: string; note: string | null; quantity: string }>;
    expect(txs.map((t) => t.type).sort()).toEqual(['adjustment_in', 'adjustment_out']);
    const out = txs.find((t) => t.type === 'adjustment_out')!;
    expect(out.usageReason).toBe('other');
    expect(out.note).toBe('Lent to S2');
    expect(Number(out.quantity)).toBe(-3);
    expect(Number(res.json().item.currentQuantity)).toBe(8);
  });

  it('reports low stock when the adjustment crosses the threshold', async () => {
    const item = await makeItem(w.s1, w.companyId, 10, 5);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await adjust(w.pm, item.id, { direction: 'out', quantity: 6, reason: 'damaged' });
      expect(res.statusCode).toBe(200);
      expect(res.json().item.isLowStock).toBe(true);
      expect(warn).toHaveBeenCalled();
      const back = await adjust(w.pm, item.id, { direction: 'in', quantity: 6, reason: 'data_entry_error' });
      expect(back.json().item.isLowStock).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

// ─── Stock guard ─────────────────────────────────────────────────────────────

describe('stock never goes negative', () => {
  it('out beyond stock gets 422 and leaves stock and history unchanged', async () => {
    const item = await makeItem();
    const res = await adjust(w.pm, item.id, { direction: 'out', quantity: 10.001, reason: 'damaged' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/Insufficient stock/);
    expect(await stockOf(item.id)).toBe(10);
    expect(await prisma.inventoryTransaction.count({ where: { inventoryId: item.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityType: 'site_inventory', entityId: item.id } })).toBe(0);
  });

  it('concurrent outs that together exceed stock cannot take it below zero', async () => {
    const item = await makeItem();
    const [r1, r2] = await Promise.all([
      adjust(w.pm, item.id, { direction: 'out', quantity: 7, reason: 'damaged' }),
      adjust(w.admin, item.id, { direction: 'out', quantity: 7, reason: 'lost_or_stolen' }),
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 422]);
    expect(await stockOf(item.id)).toBe(3);
    const txs = await prisma.inventoryTransaction.findMany({ where: { inventoryId: item.id } });
    expect(txs).toHaveLength(1);
    expect(Number(txs[0]!.quantity)).toBe(-7);
  });

  it('many concurrent outs settle at exactly zero, never below', async () => {
    const item = await makeItem();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => adjust(w.pm, item.id, { direction: 'out', quantity: 2, reason: 'damaged' })),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(5);
    expect(results.filter((r) => r.statusCode === 422)).toHaveLength(1);
    expect(await stockOf(item.id)).toBe(0);
  });

  it('in that would overflow the column gets 422', async () => {
    const item = await makeItem(w.s1, w.companyId, 999_999_000);
    const res = await adjust(w.pm, item.id, { direction: 'in', quantity: 5000, reason: 'found' });
    expect(res.statusCode).toBe(422);
    expect(await stockOf(item.id)).toBe(999_999_000);
  });
});

// ─── Audit ────────────────────────────────────────────────────────────────────

describe('audit', () => {
  it('writes an audit row with before and after quantities, actor and reason', async () => {
    const item = await makeItem();
    const res = await adjust(w.pm, item.id, { direction: 'out', quantity: 1.25, reason: 'returned_to_supplier', note: 'RMA 77' });
    expect(res.statusCode).toBe(200);
    const rows = await prisma.auditLog.findMany({ where: { entityType: 'site_inventory', entityId: item.id } });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe('update');
    expect(row.companyId).toBe(w.companyId);
    expect(row.userId).toBe(w.pm.id);
    expect(row.userRole).toBe('project_manager');
    expect(Number((row.changesBefore as { currentQuantity: string }).currentQuantity)).toBe(10);
    const after = row.changesAfter as { currentQuantity: string; adjustment: Record<string, unknown> };
    expect(Number(after.currentQuantity)).toBe(8.75);
    expect(after.adjustment).toMatchObject({ direction: 'out', reason: 'returned_to_supplier', note: 'RMA 77' });
    expect(Number(after.adjustment['quantity'])).toBe(1.25);
    const tx = await prisma.inventoryTransaction.findFirstOrThrow({ where: { inventoryId: item.id } });
    expect(after.adjustment['transactionId']).toBe(tx.id);
  });
});

// ─── Roles ────────────────────────────────────────────────────────────────────

describe('roles', () => {
  it.each(['site_supervisor', 'finance_officer', 'consultant', 'contractor', 'worker', 'viewer'])(
    '%s gets 403 and stock is unchanged',
    async (role) => {
      const item = await makeItem();
      const res = await adjust(w.others[role]!, item.id, { direction: 'out', quantity: 1, reason: 'damaged' });
      expect(res.statusCode).toBe(403);
      expect(await stockOf(item.id)).toBe(10);
      expect(await prisma.inventoryTransaction.count({ where: { inventoryId: item.id } })).toBe(0);
    },
  );

  it('a site supervisor can still record usage on the same item', async () => {
    const item = await makeItem();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${w.p1}/sites/${w.s1}/inventory/${item.id}/use`,
      headers: { authorization: `Bearer ${w.others['site_supervisor']!.accessToken}` },
      payload: { quantity: 1 },
    });
    expect(res.statusCode).toBe(200);
  });

  it('a project manager who is not a member of the project gets 403', async () => {
    const item = await makeItem();
    const res = await adjust(w.outsiderPm, item.id, { direction: 'in', quantity: 1, reason: 'found' });
    expect(res.statusCode).toBe(403);
    expect(await stockOf(item.id)).toBe(10);
  });
});

// ─── Tenant and site isolation ───────────────────────────────────────────────

describe('isolation', () => {
  it('another company\'s admin gets 404 on our project', async () => {
    const item = await makeItem();
    const res = await adjust(w.foreignAdmin, item.id, { direction: 'out', quantity: 1, reason: 'damaged' });
    expect(res.statusCode).toBe(404);
    expect(await stockOf(item.id)).toBe(10);
  });

  it('another company\'s site through our project URL gets 404', async () => {
    const foreign = await makeItem(w.y, (await prisma.jobSite.findUniqueOrThrow({ where: { id: w.y } })).companyId);
    const res = await adjust(w.admin, foreign.id, { direction: 'out', quantity: 1, reason: 'damaged' }, w.p1, w.y);
    expect(res.statusCode).toBe(404);
    expect(await stockOf(foreign.id)).toBe(10);
  });

  it('another company\'s item through our own site URL gets 404', async () => {
    const foreign = await makeItem(w.y, (await prisma.jobSite.findUniqueOrThrow({ where: { id: w.y } })).companyId);
    const res = await adjust(w.admin, foreign.id, { direction: 'out', quantity: 1, reason: 'damaged' });
    expect(res.statusCode).toBe(404);
    expect(await stockOf(foreign.id)).toBe(10);
  });

  it('a site of another project (inaccessible through this project) gets 404', async () => {
    const other = await makeItem(w.x);
    const res = await adjust(w.pm, other.id, { direction: 'out', quantity: 1, reason: 'damaged' }, w.p1, w.x);
    expect(res.statusCode).toBe(404);
    expect(await stockOf(other.id)).toBe(10);
  });

  it('an item of another site through this site URL gets 404', async () => {
    const other = await makeItem(w.x);
    const res = await adjust(w.admin, other.id, { direction: 'out', quantity: 1, reason: 'damaged' });
    expect(res.statusCode).toBe(404);
    expect(await stockOf(other.id)).toBe(10);
  });

  it('returns the same status as /use for each isolation case', async () => {
    const own = await makeItem();
    const other = await makeItem(w.x);
    const cases: Array<[TestUser, string, string, string]> = [
      [w.foreignAdmin, w.p1, w.s1, own.id],
      [w.pm, w.p1, w.x, other.id],
      [w.admin, w.p1, w.s1, other.id],
      [w.outsiderPm, w.p1, w.s1, own.id],
    ];
    for (const [user, projectId, siteId, id] of cases) {
      const use = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/sites/${siteId}/inventory/${id}/use`,
        headers: { authorization: `Bearer ${user.accessToken}` },
        payload: { quantity: 1 },
      });
      const adj = await adjust(user, id, { direction: 'out', quantity: 1, reason: 'damaged' }, projectId, siteId);
      expect(adj.statusCode).toBe(use.statusCode);
    }
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('validation', () => {
  it.each<[string, unknown]>([
    ['missing direction', { quantity: 1, reason: 'damaged' }],
    ['bad direction', { direction: 'sideways', quantity: 1, reason: 'damaged' }],
    ['zero quantity', { direction: 'in', quantity: 0, reason: 'damaged' }],
    ['negative quantity', { direction: 'in', quantity: -1, reason: 'damaged' }],
    ['string quantity', { direction: 'in', quantity: '5', reason: 'damaged' }],
    ['too many decimals', { direction: 'in', quantity: 1.0001, reason: 'damaged' }],
    ['unknown reason', { direction: 'in', quantity: 1, reason: 'because' }],
    ['missing reason', { direction: 'in', quantity: 1 }],
    ['unknown field', { direction: 'in', quantity: 1, reason: 'damaged', currentQuantity: 500 }],
    ['non-string note', { direction: 'in', quantity: 1, reason: 'damaged', note: 5 }],
  ])('%s gets 422', async (_label, body) => {
    const item = await makeItem();
    const res = await adjust(w.pm, item.id, body);
    expect(res.statusCode).toBe(422);
    expect(await stockOf(item.id)).toBe(10);
  });

  it('other without a note gets 422', async () => {
    const item = await makeItem();
    const res = await adjust(w.pm, item.id, { direction: 'out', quantity: 1, reason: 'other' });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/note is required/);
    expect(await stockOf(item.id)).toBe(10);
  });

  it('other with a blank note gets 422', async () => {
    const item = await makeItem();
    const res = await adjust(w.pm, item.id, { direction: 'out', quantity: 1, reason: 'other', note: '   ' });
    expect(res.statusCode).toBe(422);
    expect(await stockOf(item.id)).toBe(10);
  });

  it('other with a note is accepted', async () => {
    const item = await makeItem();
    const res = await adjust(w.pm, item.id, { direction: 'out', quantity: 1, reason: 'other', note: 'Sample to lab' });
    expect(res.statusCode).toBe(200);
    expect(await stockOf(item.id)).toBe(9);
  });

  it('an unknown inventory id gets 404', async () => {
    const res = await adjust(w.pm, '00000000-0000-4000-8000-000000000000', { direction: 'in', quantity: 1, reason: 'found' });
    expect(res.statusCode).toBe(404);
  });
});
