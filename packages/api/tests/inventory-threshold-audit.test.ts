/**
 * PATCH /projects/:projectId/sites/:siteId/inventory/:inventoryId
 *
 * Changing an item's low-stock level writes one audit row with the level
 * before and after, the actor, and the request's IP and user agent, in the
 * same transaction as the change. A request that changes nothing in the
 * database (rejected, out of scope, unknown item) writes no audit row.
 */
import { FastifyInstance } from 'fastify';
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

let admin: TestUser;
let pm: TestUser;
let supervisor: TestUser;
let viewer: TestUser;
let foreignAdmin: TestUser;
let companyId: string;
let p1: string;
let s1: string;
let x: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'thr-a');
  const b = await createTestCompany(app, 'thr-b');
  companyId = a.company.id;
  admin = a.admin;
  foreignAdmin = b.admin;

  const project = await createTestProject(companyId, 'P1');
  const site = await createTestSite(companyId, project.id, 'S1');
  const other = await createTestProject(companyId, 'P2');
  const otherSite = await createTestSite(companyId, other.id, 'X');
  p1 = project.id; s1 = site.id; x = otherSite.id;

  pm = await createTestUser(app, companyId, 'project_manager', 'thr-pm');
  supervisor = await createTestUser(app, companyId, 'site_supervisor', 'thr-sup');
  viewer = await createTestUser(app, companyId, 'viewer', 'thr-view');
  await assignUserToProject(companyId, p1, pm.id);
  await assignUserToProject(companyId, p1, supervisor.id, s1);
  await assignUserToProject(companyId, p1, viewer.id);
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

function makeItem(threshold: number | null = null, siteId = s1) {
  return prisma.siteInventory.create({
    data: {
      companyId, siteId,
      materialName: `Cement-${Math.random().toString(36).slice(2, 8)}`,
      unitOfMeasure: 'bags',
      currentQuantity: 10,
      lowStockThreshold: threshold,
    },
  });
}

function setLevel(
  user: TestUser, inventoryId: string, body: unknown,
  projectId = p1, siteId = s1, headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/projects/${projectId}/sites/${siteId}/inventory/${inventoryId}`,
    headers: { authorization: `Bearer ${user.accessToken}`, ...headers },
    payload: body as Record<string, unknown>,
  });
}

function auditRows(inventoryId: string) {
  return prisma.auditLog.findMany({
    where: { entityType: 'site_inventory', entityId: inventoryId },
    orderBy: { createdAt: 'asc' },
  });
}

type Snapshot = { lowStockThreshold: string | null };

describe('audit of low-stock level changes', () => {
  it('setting a level writes one audit row with before, after, actor, ip and user agent', async () => {
    const item = await makeItem();
    const res = await setLevel(pm, item.id, { lowStockThreshold: 4.5 }, p1, s1, { 'user-agent': 'threshold-test/1.0' });
    expect(res.statusCode).toBe(200);
    expect(Number(res.json().item.lowStockThreshold)).toBe(4.5);

    const rows = await auditRows(item.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.action).toBe('update');
    expect(row.companyId).toBe(companyId);
    expect(row.userId).toBe(pm.id);
    expect(row.userEmail).toBe(pm.email);
    expect(row.userRole).toBe('project_manager');
    expect((row.changesBefore as Snapshot).lowStockThreshold).toBeNull();
    expect(Number((row.changesAfter as Snapshot).lowStockThreshold)).toBe(4.5);
    expect(row.userAgent).toBe('threshold-test/1.0');
    expect(row.ipAddress).toBeTruthy();
  });

  it('changing and clearing a level records each previous value', async () => {
    const item = await makeItem(5);
    expect((await setLevel(supervisor, item.id, { lowStockThreshold: 8 })).statusCode).toBe(200);
    expect((await setLevel(admin, item.id, { lowStockThreshold: null })).statusCode).toBe(200);

    const rows = await auditRows(item.id);
    expect(rows).toHaveLength(2);
    expect(Number((rows[0]!.changesBefore as Snapshot).lowStockThreshold)).toBe(5);
    expect(Number((rows[0]!.changesAfter as Snapshot).lowStockThreshold)).toBe(8);
    expect(rows[0]!.userId).toBe(supervisor.id);
    expect(Number((rows[1]!.changesBefore as Snapshot).lowStockThreshold)).toBe(8);
    expect((rows[1]!.changesAfter as Snapshot).lowStockThreshold).toBeNull();
    expect(rows[1]!.userId).toBe(admin.id);
  });

  it('the stock quantity is not touched and is not reported as changed', async () => {
    const item = await makeItem(null);
    await setLevel(pm, item.id, { lowStockThreshold: 2 });
    const row = (await auditRows(item.id))[0]!;
    expect(row.changesBefore).toEqual({ lowStockThreshold: null });
    expect(row.changesAfter).toEqual({ lowStockThreshold: '2' });
    const stored = await prisma.siteInventory.findUniqueOrThrow({ where: { id: item.id } });
    expect(Number(stored.currentQuantity)).toBe(10);
  });

  it('concurrent level changes each record the value they replaced', async () => {
    const item = await makeItem(1);
    const levels = [2, 3, 4, 5, 6, 7];
    const results = await Promise.all(levels.map((l) => setLevel(pm, item.id, { lowStockThreshold: l })));
    expect(results.map((r) => r.statusCode)).toEqual(levels.map(() => 200));

    const rows = await auditRows(item.id);
    expect(rows).toHaveLength(levels.length);
    // The changes were applied one after another: each before value is a
    // distinct earlier after value (or the starting level), forming one chain
    // that ends at the stored level.
    const befores = rows.map((r) => Number((r.changesBefore as Snapshot).lowStockThreshold));
    const afters  = rows.map((r) => Number((r.changesAfter as Snapshot).lowStockThreshold));
    expect(new Set(befores).size).toBe(levels.length);
    expect(new Set(afters).size).toBe(levels.length);
    const stored = Number((await prisma.siteInventory.findUniqueOrThrow({ where: { id: item.id } })).lowStockThreshold);
    const startOfChain = befores.filter((b) => !afters.includes(b));
    const endOfChain   = afters.filter((a) => !befores.includes(a));
    expect(startOfChain).toEqual([1]);
    expect(endOfChain).toEqual([stored]);
  });
});

describe('no audit row when nothing changes', () => {
  it('an invalid level gets 422 and writes nothing', async () => {
    const item = await makeItem(3);
    const res = await setLevel(pm, item.id, { lowStockThreshold: -1 });
    expect(res.statusCode).toBe(422);
    expect(await auditRows(item.id)).toHaveLength(0);
  });

  it('a viewer gets 403 and writes nothing', async () => {
    const item = await makeItem(3);
    const res = await setLevel(viewer, item.id, { lowStockThreshold: 9 });
    expect(res.statusCode).toBe(403);
    expect(await auditRows(item.id)).toHaveLength(0);
  });

  it('another company\'s admin gets 404 and writes nothing', async () => {
    const item = await makeItem(3);
    const res = await setLevel(foreignAdmin, item.id, { lowStockThreshold: 9 });
    expect(res.statusCode).toBe(404);
    expect(await auditRows(item.id)).toHaveLength(0);
    const stored = await prisma.siteInventory.findUniqueOrThrow({ where: { id: item.id } });
    expect(Number(stored.lowStockThreshold)).toBe(3);
  });

  it('an item of another project\'s site through this site URL gets 404 and writes nothing', async () => {
    const other = await makeItem(3, x);
    const res = await setLevel(admin, other.id, { lowStockThreshold: 9 });
    expect(res.statusCode).toBe(404);
    expect(await auditRows(other.id)).toHaveLength(0);
  });
});
