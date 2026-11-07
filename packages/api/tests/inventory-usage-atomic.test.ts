/**
 * POST /projects/:projectId/sites/:siteId/inventory/:inventoryId/use
 *
 * Usage deducts stock with a conditional update inside one transaction, so
 * concurrent requests (usage, or usage mixed with adjustments) can never take
 * stock below zero. Each successful usage writes a usage_out transaction and
 * an audit row; a refused one writes neither. Roles and scoping are unchanged:
 * company_admin, project_manager and site_supervisor may record usage.
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
  supervisor: TestUser;        // assigned to S1 only
  outsiderPm: TestUser;        // company A, not a member of P1
  foreignAdmin: TestUser;      // company B
  companyId: string;
  foreignCompanyId: string;
  p1: string; s1: string; s2: string;
  p2: string; x: string;       // same company, other project
  q: string;  y: string;       // other company
  others: Record<string, TestUser>;
}

let w: World;

const UA = 'inventory-usage-atomic-test/1.0';

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'use-a');
  const b = await createTestCompany(app, 'use-b');
  const cid = a.company.id;

  const p1 = await createTestProject(cid, 'P1');
  const s1 = await createTestSite(cid, p1.id, 'S1');
  const s2 = await createTestSite(cid, p1.id, 'S2');
  const p2 = await createTestProject(cid, 'P2');
  const x  = await createTestSite(cid, p2.id, 'X');
  const q  = await createTestProject(b.company.id, 'Q');
  const y  = await createTestSite(b.company.id, q.id, 'Y');

  const pm         = await createTestUser(app, cid, 'project_manager', 'use-pm');
  const outsiderPm = await createTestUser(app, cid, 'project_manager', 'use-out');
  const supervisor = await createTestUser(app, cid, 'site_supervisor', 'use-sup');
  await assignUserToProject(cid, p1.id, pm.id);
  await assignUserToProject(cid, p2.id, outsiderPm.id);
  await assignUserToProject(cid, p1.id, supervisor.id, s1.id);

  const others: Record<string, TestUser> = {};
  for (const role of ['finance_officer', 'consultant', 'contractor', 'worker', 'viewer'] as UserRole[]) {
    const u = await createTestUser(app, cid, role, `use-${role}`, { canViewFinance: role === 'finance_officer' });
    if (role !== 'finance_officer') await assignUserToProject(cid, p1.id, u.id);
    others[role] = u;
  }

  w = {
    admin: a.admin, pm, supervisor, outsiderPm, foreignAdmin: b.admin,
    companyId: cid, foreignCompanyId: b.company.id,
    p1: p1.id, s1: s1.id, s2: s2.id, p2: p2.id, x: x.id, q: q.id, y: y.id, others,
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
      materialName: `Sand-${Math.random().toString(36).slice(2, 8)}`,
      unitOfMeasure: 'tonnes',
      currentQuantity: qty,
      lowStockThreshold: threshold,
    },
  });
}

function use(user: TestUser | null, inventoryId: string, body: unknown, projectId = w.p1, siteId = w.s1) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/sites/${siteId}/inventory/${inventoryId}/use`,
    headers: user
      ? { authorization: `Bearer ${user.accessToken}`, 'user-agent': UA }
      : { 'user-agent': UA },
    payload: body as Record<string, unknown>,
  });
}

function adjustOut(user: TestUser, inventoryId: string, quantity: number) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/projects/${w.p1}/sites/${w.s1}/inventory/${inventoryId}/adjust`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: { direction: 'out', quantity, reason: 'damaged' },
  });
}

async function stockOf(id: string): Promise<number> {
  const row = await prisma.siteInventory.findUniqueOrThrow({ where: { id } });
  return Number(row.currentQuantity);
}

function txCount(inventoryId: string) {
  return prisma.inventoryTransaction.count({ where: { inventoryId } });
}

function auditRows(inventoryId: string) {
  return prisma.auditLog.findMany({
    where: { entityType: 'site_inventory', entityId: inventoryId },
    orderBy: { createdAt: 'asc' },
  });
}

// ─── Concurrency ──────────────────────────────────────────────────────────────

describe('concurrent usage', () => {
  it('two concurrent uses that together exceed stock: one succeeds, one gets 422', async () => {
    const item = await makeItem();
    const [r1, r2] = await Promise.all([
      use(w.pm, item.id, { quantity: 7 }),
      use(w.supervisor, item.id, { quantity: 7 }),
    ]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([200, 422]);
    const refused = [r1, r2].find((r) => r.statusCode === 422)!;
    expect(refused.json().error).toMatch(/Insufficient stock/);
    expect(await stockOf(item.id)).toBe(3);
    const txs = await prisma.inventoryTransaction.findMany({ where: { inventoryId: item.id } });
    expect(txs).toHaveLength(1);
    expect(Number(txs[0]!.quantity)).toBe(-7);
  });

  it('many concurrent uses: exactly N succeed and stock settles at the expected value', async () => {
    const item = await makeItem(w.s1, w.companyId, 10);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => use(i % 2 ? w.pm : w.admin, item.id, { quantity: 3 })),
    );
    // floor(10 / 3) = 3 succeed, 1 remains
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(3);
    expect(results.filter((r) => r.statusCode === 422)).toHaveLength(5);
    const final = await stockOf(item.id);
    expect(final).toBeGreaterThanOrEqual(0);
    expect(final).toBe(1);
    expect(await txCount(item.id)).toBe(3);
    expect(await auditRows(item.id)).toHaveLength(3);
  });

  it('concurrent uses that exactly drain stock all succeed and end at zero', async () => {
    const item = await makeItem(w.s1, w.companyId, 10);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => use(w.pm, item.id, { quantity: 2 })),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(await stockOf(item.id)).toBe(0);
  });

  it('a mix of concurrent use and adjust_out never goes negative', async () => {
    const item = await makeItem(w.s1, w.companyId, 10);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => (i % 2 ? adjustOut(w.pm, item.id, 2) : use(w.supervisor, item.id, { quantity: 2 }))),
    );
    const ok = results.filter((r) => r.statusCode === 200).length;
    expect(ok).toBe(5);
    expect(results.filter((r) => r.statusCode === 422)).toHaveLength(5);
    expect(await stockOf(item.id)).toBe(0);
    const txs = await prisma.inventoryTransaction.findMany({ where: { inventoryId: item.id } });
    expect(txs).toHaveLength(5);
    const sum = txs.reduce((s, t) => s + Number(t.quantity), 0);
    expect(sum).toBe(-10);
    for (const t of txs) expect(['usage_out', 'adjustment_out']).toContain(t.type);
    // one audit row per successful change (usage or adjustment)
    expect(await auditRows(item.id)).toHaveLength(5);
  });
});

// ─── Single-request behaviour ────────────────────────────────────────────────

describe('single usage', () => {
  it('use beyond stock gets 422 and writes nothing', async () => {
    const item = await makeItem();
    const res = await use(w.pm, item.id, { quantity: 10.5 });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/Insufficient stock: requested 10.5, available 10/);
    expect(await stockOf(item.id)).toBe(10);
    expect(await txCount(item.id)).toBe(0);
    expect(await auditRows(item.id)).toHaveLength(0);
  });

  it('use of the full stock takes it to exactly zero', async () => {
    const item = await makeItem();
    const res = await use(w.pm, item.id, { quantity: 10 });
    expect(res.statusCode).toBe(200);
    expect(await stockOf(item.id)).toBe(0);
  });

  it('keeps the response shape: { item } with the inventory fields and isLowStock', async () => {
    const item = await makeItem();
    const res = await use(w.pm, item.id, { quantity: 1 });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body)).toEqual(['item']);
    expect(Object.keys(body.item).sort()).toEqual([
      'companyId', 'createdAt', 'currentQuantity', 'id', 'isLowStock', 'lowStockThreshold',
      'materialName', 'site', 'siteId', 'unitOfMeasure', 'updatedAt',
    ]);
    expect(body.item.id).toBe(item.id);
    expect(Number(body.item.currentQuantity)).toBe(9);
    expect(body.item.site).toEqual({ id: w.s1, name: 'S1' });
    expect(body.item.isLowStock).toBe(false);
  });

  it('reports low stock and warns when the usage crosses the threshold', async () => {
    const item = await makeItem(w.s1, w.companyId, 10, 5);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const above = await use(w.pm, item.id, { quantity: 4 });
      expect(above.json().item.isLowStock).toBe(false);
      expect(warn).not.toHaveBeenCalled();
      const res = await use(w.pm, item.id, { quantity: 1 });
      expect(res.statusCode).toBe(200);
      expect(res.json().item.isLowStock).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('an unknown inventory id gets 404 and writes nothing', async () => {
    const res = await use(w.pm, '00000000-0000-4000-8000-000000000000', { quantity: 1 });
    expect(res.statusCode).toBe(404);
  });

  it.each<[string, unknown]>([
    ['missing quantity', {}],
    ['zero quantity', { quantity: 0 }],
    ['negative quantity', { quantity: -1 }],
    ['string quantity', { quantity: '2' }],
    ['bad scheduleTaskId', { quantity: 1, scheduleTaskId: 'nope' }],
  ])('%s gets 422 and writes nothing', async (_label, body) => {
    const item = await makeItem();
    const res = await use(w.pm, item.id, body);
    expect(res.statusCode).toBe(422);
    expect(await stockOf(item.id)).toBe(10);
    expect(await txCount(item.id)).toBe(0);
    expect(await auditRows(item.id)).toHaveLength(0);
  });
});

// ─── Audit ────────────────────────────────────────────────────────────────────

describe('audit', () => {
  it('writes one audit row per successful usage with before/after, actor, IP and UA', async () => {
    const item = await makeItem();
    const res = await use(w.supervisor, item.id, {
      quantity: 2.5, usageReason: 'Slab pour', workArea: 'Block B level 2', note: 'Morning shift',
    });
    expect(res.statusCode).toBe(200);
    const rows = await auditRows(item.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe('update');
    expect(row.entityType).toBe('site_inventory');
    expect(row.entityId).toBe(item.id);
    expect(row.companyId).toBe(w.companyId);
    expect(row.userId).toBe(w.supervisor.id);
    expect(row.userEmail).toBe(w.supervisor.email);
    expect(row.userRole).toBe('site_supervisor');
    expect(row.ipAddress).toBeTruthy();
    expect(row.userAgent).toBe(UA);
    expect(Number((row.changesBefore as { currentQuantity: string }).currentQuantity)).toBe(10);
    const after = row.changesAfter as { currentQuantity: string; usage: Record<string, unknown> };
    expect(Number(after.currentQuantity)).toBe(7.5);
    expect(after.usage).toMatchObject({
      usageReason: 'Slab pour', workArea: 'Block B level 2', note: 'Morning shift', scheduleTaskId: null,
    });
    expect(Number(after.usage['quantity'])).toBe(2.5);
    const tx = await prisma.inventoryTransaction.findFirstOrThrow({ where: { inventoryId: item.id } });
    expect(after.usage['transactionId']).toBe(tx.id);
  });

  it('sequential usages each record their own before and after', async () => {
    const item = await makeItem();
    await use(w.pm, item.id, { quantity: 3 });
    await use(w.pm, item.id, { quantity: 4 });
    const rows = await auditRows(item.id);
    expect(rows).toHaveLength(2);
    const pairs = rows
      .map((r) => [
        Number((r.changesBefore as { currentQuantity: string }).currentQuantity),
        Number((r.changesAfter as { currentQuantity: string }).currentQuantity),
      ])
      .sort((a, b) => b[0]! - a[0]!);
    expect(pairs).toEqual([[10, 7], [7, 3]]);
  });

  it('a refused usage writes no audit row', async () => {
    const item = await makeItem(w.s1, w.companyId, 1);
    const res = await use(w.pm, item.id, { quantity: 2 });
    expect(res.statusCode).toBe(422);
    expect(await auditRows(item.id)).toHaveLength(0);
  });
});

// ─── Attribution ──────────────────────────────────────────────────────────────

describe('attribution', () => {
  it('the usage_out transaction keeps performer, work area, reason, note and schedule task', async () => {
    const item = await makeItem();
    const taskId = '11111111-2222-4333-8444-555555555555';
    const res = await use(w.supervisor, item.id, {
      quantity: 1.5, usageReason: 'Plastering', workArea: 'Unit 4', note: 'Gang 2', scheduleTaskId: taskId,
    });
    expect(res.statusCode).toBe(200);
    const txs = await prisma.inventoryTransaction.findMany({ where: { inventoryId: item.id } });
    expect(txs).toHaveLength(1);
    const t = txs[0]!;
    expect(t.type).toBe('usage_out');
    expect(Number(t.quantity)).toBe(-1.5);
    expect(t.unitOfMeasure).toBe('tonnes');
    expect(t.performedById).toBe(w.supervisor.id);
    expect(t.workArea).toBe('Unit 4');
    expect(t.usageReason).toBe('Plastering');
    expect(t.note).toBe('Gang 2');
    expect(t.scheduleTaskId).toBe(taskId);
    expect(t.companyId).toBe(w.companyId);
    expect(t.siteId).toBe(w.s1);
    expect(t.deliveryId).toBeNull();
  });

  it('optional fields default to null', async () => {
    const item = await makeItem();
    await use(w.admin, item.id, { quantity: 1 });
    const t = await prisma.inventoryTransaction.findFirstOrThrow({ where: { inventoryId: item.id } });
    expect(t.performedById).toBe(w.admin.id);
    expect(t.workArea).toBeNull();
    expect(t.usageReason).toBeNull();
    expect(t.note).toBeNull();
    expect(t.scheduleTaskId).toBeNull();
  });

  it('each concurrent usage is attributed to its own caller', async () => {
    const item = await makeItem(w.s1, w.companyId, 100);
    const results = await Promise.all([
      use(w.admin, item.id, { quantity: 1, workArea: 'A' }),
      use(w.pm, item.id, { quantity: 2, workArea: 'B' }),
      use(w.supervisor, item.id, { quantity: 3, workArea: 'C' }),
    ]);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const txs = await prisma.inventoryTransaction.findMany({ where: { inventoryId: item.id } });
    const byArea = Object.fromEntries(txs.map((t) => [t.workArea, [t.performedById, Number(t.quantity)]]));
    expect(byArea).toEqual({
      A: [w.admin.id, -1],
      B: [w.pm.id, -2],
      C: [w.supervisor.id, -3],
    });
    expect(await stockOf(item.id)).toBe(94);
  });
});

// ─── Authorisation matrix (unchanged) ────────────────────────────────────────

describe('authorisation', () => {
  it.each(['admin', 'pm', 'supervisor'] as const)('%s may record usage', async (who) => {
    const item = await makeItem();
    const res = await use(w[who], item.id, { quantity: 1 });
    expect(res.statusCode).toBe(200);
    expect(await stockOf(item.id)).toBe(9);
  });

  it.each(['finance_officer', 'consultant', 'contractor', 'worker', 'viewer'])(
    '%s gets 403 and nothing is written',
    async (role) => {
      const item = await makeItem();
      const res = await use(w.others[role]!, item.id, { quantity: 1 });
      expect(res.statusCode).toBe(403);
      expect(await stockOf(item.id)).toBe(10);
      expect(await txCount(item.id)).toBe(0);
      expect(await auditRows(item.id)).toHaveLength(0);
    },
  );

  it('no token gets 401', async () => {
    const item = await makeItem();
    const res = await use(null, item.id, { quantity: 1 });
    expect(res.statusCode).toBe(401);
    expect(await stockOf(item.id)).toBe(10);
  });

  it('a project manager who is not a member of the project gets 403', async () => {
    const item = await makeItem();
    const res = await use(w.outsiderPm, item.id, { quantity: 1 });
    expect(res.statusCode).toBe(403);
    expect(await stockOf(item.id)).toBe(10);
    expect(await auditRows(item.id)).toHaveLength(0);
  });

  it('a site supervisor on a site of the project they are not assigned to gets 404', async () => {
    const item = await makeItem(w.s2);
    const res = await use(w.supervisor, item.id, { quantity: 1 }, w.p1, w.s2);
    expect(res.statusCode).toBe(404);
    expect(await stockOf(item.id)).toBe(10);
  });

  it('a project manager may use stock on any site of their project', async () => {
    const item = await makeItem(w.s2);
    const res = await use(w.pm, item.id, { quantity: 1 }, w.p1, w.s2);
    expect(res.statusCode).toBe(200);
  });

  it('another company\'s admin gets 404 on our project', async () => {
    const item = await makeItem();
    const res = await use(w.foreignAdmin, item.id, { quantity: 1 });
    expect(res.statusCode).toBe(404);
    expect(await stockOf(item.id)).toBe(10);
  });

  it('another company\'s site through our project URL gets 404', async () => {
    const foreign = await makeItem(w.y, w.foreignCompanyId);
    const res = await use(w.admin, foreign.id, { quantity: 1 }, w.p1, w.y);
    expect(res.statusCode).toBe(404);
    expect(await stockOf(foreign.id)).toBe(10);
  });

  it('another company\'s item through our own site URL gets 404', async () => {
    const foreign = await makeItem(w.y, w.foreignCompanyId);
    const res = await use(w.admin, foreign.id, { quantity: 1 });
    expect(res.statusCode).toBe(404);
    expect(await stockOf(foreign.id)).toBe(10);
    expect(await txCount(foreign.id)).toBe(0);
  });

  it('a site of another project through this project URL gets 404', async () => {
    const other = await makeItem(w.x);
    const res = await use(w.pm, other.id, { quantity: 1 }, w.p1, w.x);
    expect(res.statusCode).toBe(404);
    expect(await stockOf(other.id)).toBe(10);
  });

  it('an item of another site through this site URL gets 404', async () => {
    const other = await makeItem(w.x);
    const res = await use(w.admin, other.id, { quantity: 1 });
    expect(res.statusCode).toBe(404);
    expect(await stockOf(other.id)).toBe(10);
  });

  it('adjustments are still limited to company_admin and project_manager', async () => {
    const item = await makeItem();
    const res = await adjustOut(w.supervisor, item.id, 1);
    expect(res.statusCode).toBe(403);
    expect(await stockOf(item.id)).toBe(10);
  });
});
