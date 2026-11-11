/**
 * Access scope for two groups of site routes:
 *
 *   inventory   GET    /projects/:projectId/sites/:siteId/inventory
 *               GET    /projects/:projectId/sites/:siteId/inventory/:inventoryId
 *               PATCH  /projects/:projectId/sites/:siteId/inventory/:inventoryId
 *   labour      GET    /projects/:projectId/sites/:siteId/labour/:entryId
 *               PATCH  /projects/:projectId/sites/:siteId/labour/:entryId
 *               DELETE /projects/:projectId/sites/:siteId/labour/:entryId
 *
 * Rules: the caller's role must be on the route's list; the project must be in
 * the caller's company and, for roles that are not company-wide, the caller
 * must be an active member of it; the site must belong to that project; a site
 * supervisor is limited to their assigned sites; and the record must belong to
 * the company, project and site in the URL. Refused requests change nothing.
 *
 * The stock usage and adjustment routes have their own files
 * (inventory-usage-atomic, inventory-adjust); labour create and list are in
 * labour.test.ts and the wage tests.
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
  createTestWorker,
  createTestLabourEntry,
  assignUserToProject,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

type Method = 'GET' | 'PATCH' | 'DELETE';

interface Ids { s1: string; s2: string; x: string; y: string }

interface World {
  admin: TestUser;
  pm: TestUser;             // member of P1
  sup: TestUser;            // site supervisor, P1 / S1 only
  fo: TestUser;             // finance officer (company-wide)
  outsiderPm: TestUser;     // same company, member of P2 only
  removedPm: TestUser;      // membership of P1 ended
  foreignAdmin: TestUser;   // company B
  refused: Record<string, TestUser>;
  p1: string; s1: string; s2: string;   // company A, project P1 with two sites
  p2: string; x: string;                // company A, project P2 with site X
  q: string;  y: string;                // company B, project Q with site Y
  item: Ids;
  entry: Ids;
}

let w: World;

/** Roles that are on neither the inventory nor the labour route lists. */
const REFUSED_ROLES: UserRole[] = ['viewer', 'consultant', 'contractor', 'worker'];

const HOURS = 8;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'scope-il-a');
  const b = await createTestCompany(app, 'scope-il-b');
  const cid = a.company.id;
  const bid = b.company.id;

  const p1 = await createTestProject(cid, 'P1');
  const s1 = await createTestSite(cid, p1.id, 'S1');
  const s2 = await createTestSite(cid, p1.id, 'S2');
  const p2 = await createTestProject(cid, 'P2');
  const x  = await createTestSite(cid, p2.id, 'X');
  const q  = await createTestProject(bid, 'Q');
  const y  = await createTestSite(bid, q.id, 'Y');

  const pm         = await createTestUser(app, cid, 'project_manager', 'scope-il-pm');
  const sup        = await createTestUser(app, cid, 'site_supervisor', 'scope-il-sup');
  const fo         = await createTestUser(app, cid, 'finance_officer', 'scope-il-fo', { canViewFinance: true });
  const outsiderPm = await createTestUser(app, cid, 'project_manager', 'scope-il-out');
  const removedPm  = await createTestUser(app, cid, 'project_manager', 'scope-il-gone');
  await assignUserToProject(cid, p1.id, pm.id);
  await assignUserToProject(cid, p1.id, sup.id, s1.id);
  await assignUserToProject(cid, p2.id, outsiderPm.id);
  await assignUserToProject(cid, p1.id, removedPm.id);
  await prisma.projectMember.updateMany({
    where: { projectId: p1.id, userId: removedPm.id },
    data:  { removedAt: new Date() },
  });

  const refused: Record<string, TestUser> = {};
  for (const role of REFUSED_ROLES) {
    const u = await createTestUser(app, cid, role, `scope-il-${role}`);
    await assignUserToProject(cid, p1.id, u.id);
    refused[role] = u;
  }

  const makeItem = async (companyId: string, siteId: string, name: string) =>
    (await prisma.siteInventory.create({
      data: { companyId, siteId, materialName: name, unitOfMeasure: 'bags', currentQuantity: 10 },
    })).id;

  const workerA = await createTestWorker(cid);
  const workerB = await createTestWorker(bid);
  const makeEntry = async (companyId: string, projectId: string, siteId: string, workerId: string, by: string) =>
    (await createTestLabourEntry(companyId, projectId, siteId, workerId, by, { hoursWorked: HOURS })).id;

  w = {
    admin: a.admin, pm, sup, fo, outsiderPm, removedPm, foreignAdmin: b.admin, refused,
    p1: p1.id, s1: s1.id, s2: s2.id, p2: p2.id, x: x.id, q: q.id, y: y.id,
    item: {
      s1: await makeItem(cid, s1.id, 'Cement S1'),
      s2: await makeItem(cid, s2.id, 'Cement S2'),
      x:  await makeItem(cid, x.id, 'Cement X'),
      y:  await makeItem(bid, y.id, 'Cement Y'),
    },
    entry: {
      s1: await makeEntry(cid, p1.id, s1.id, workerA.id, a.admin.id),
      s2: await makeEntry(cid, p1.id, s2.id, workerA.id, a.admin.id),
      x:  await makeEntry(cid, p2.id, x.id, workerA.id, a.admin.id),
      y:  await makeEntry(bid, q.id, y.id, workerB.id, b.admin.id),
    },
  };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const invUrl = (projectId: string, siteId: string, inventoryId?: string) =>
  `/api/v1/projects/${projectId}/sites/${siteId}/inventory${inventoryId ? `/${inventoryId}` : ''}`;

const labUrl = (projectId: string, siteId: string, entryId: string) =>
  `/api/v1/projects/${projectId}/sites/${siteId}/labour/${entryId}`;

function call(user: TestUser | null, method: Method, url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method,
    url,
    headers: user ? { authorization: `Bearer ${user.accessToken}` } : {},
    ...(payload ? { payload } : {}),
  });
}

async function status(user: TestUser | null, method: Method, url: string, payload?: Record<string, unknown>) {
  return (await call(user, method, url, payload)).statusCode;
}

/** Stored threshold of an inventory item (null when none is set). */
async function threshold(inventoryId: string): Promise<number | null> {
  const row = await prisma.siteInventory.findUniqueOrThrow({ where: { id: inventoryId } });
  return row.lowStockThreshold === null ? null : Number(row.lowStockThreshold);
}

/** Stored hours of a labour entry (null when the entry no longer exists). */
async function hours(entryId: string): Promise<number | null> {
  const row = await prisma.labourEntry.findUnique({ where: { id: entryId } });
  return row ? Number(row.hoursWorked) : null;
}

const THRESHOLD = { lowStockThreshold: 3 };
const EDIT = { hoursWorked: 3 };

/** List, item and threshold update on one inventory address. */
async function inventoryStatuses(user: TestUser | null, projectId: string, siteId: string, inventoryId: string) {
  return [
    await status(user, 'GET', invUrl(projectId, siteId)),
    await status(user, 'GET', invUrl(projectId, siteId, inventoryId)),
    await status(user, 'PATCH', invUrl(projectId, siteId, inventoryId), THRESHOLD),
  ];
}

/** Read, edit and delete on one labour entry address. */
async function labourStatuses(user: TestUser | null, projectId: string, siteId: string, entryId: string) {
  return [
    await status(user, 'GET', labUrl(projectId, siteId, entryId)),
    await status(user, 'PATCH', labUrl(projectId, siteId, entryId), EDIT),
    await status(user, 'DELETE', labUrl(projectId, siteId, entryId)),
  ];
}

// ─── Inventory: roles ─────────────────────────────────────────────────────────

describe('inventory list, item and threshold: roles', () => {
  it.each(REFUSED_ROLES)('%s (a project member) gets 403 on list, item and threshold update', async (role) => {
    expect(await inventoryStatuses(w.refused[role], w.p1, w.s1, w.item.s1)).toEqual([403, 403, 403]);
    expect(await threshold(w.item.s1)).toBeNull();
  });

  it('a finance officer reads the list and an item but cannot change a threshold (403)', async () => {
    expect(await inventoryStatuses(w.fo, w.p1, w.s1, w.item.s1)).toEqual([200, 200, 403]);
    expect(await threshold(w.item.s1)).toBeNull();
  });

  it('a project manager on the project and a supervisor on their own site may set a threshold', async () => {
    expect(await status(w.pm, 'PATCH', invUrl(w.p1, w.s1, w.item.s1), { lowStockThreshold: 4 })).toBe(200);
    expect(await threshold(w.item.s1)).toBe(4);
    expect(await status(w.sup, 'PATCH', invUrl(w.p1, w.s1, w.item.s1), { lowStockThreshold: null })).toBe(200);
    expect(await threshold(w.item.s1)).toBeNull();
  });
});

// ─── Inventory: project and site scope ────────────────────────────────────────

describe('inventory list, item and threshold: project and site scope', () => {
  it('a supervisor assigned to one site gets 404 on the other site of the same project', async () => {
    const own = await call(w.sup, 'GET', invUrl(w.p1, w.s1));
    expect(own.statusCode).toBe(200);
    expect((own.json().inventory as Array<{ id: string }>).map((i) => i.id)).toEqual([w.item.s1]);

    expect(await inventoryStatuses(w.sup, w.p1, w.s2, w.item.s2)).toEqual([404, 404, 404]);
    expect(await threshold(w.item.s2)).toBeNull();
  });

  it('a project manager who is not a member of the project gets 403 on list, item and threshold update', async () => {
    expect(await inventoryStatuses(w.outsiderPm, w.p1, w.s1, w.item.s1)).toEqual([403, 403, 403]);
    expect(await threshold(w.item.s1)).toBeNull();
  });

  it('a project manager whose membership has ended gets 403 on list, item and threshold update', async () => {
    expect(await inventoryStatuses(w.removedPm, w.p1, w.s1, w.item.s1)).toEqual([403, 403, 403]);
    expect(await threshold(w.item.s1)).toBeNull();
  });

  it('the list holds only the items of the site in the URL', async () => {
    for (const [siteId, itemId] of [[w.s1, w.item.s1], [w.s2, w.item.s2]] as const) {
      const res = await call(w.admin, 'GET', invUrl(w.p1, siteId));
      expect(res.statusCode).toBe(200);
      expect((res.json().inventory as Array<{ id: string }>).map((i) => i.id)).toEqual([itemId]);
    }
  });

  it.each(['admin', 'pm'] as const)(
    '%s: an item addressed through another site of the same project is 404 for read and threshold update',
    async (who) => {
      expect(await status(w[who], 'GET', invUrl(w.p1, w.s1, w.item.s2))).toBe(404);
      expect(await status(w[who], 'PATCH', invUrl(w.p1, w.s1, w.item.s2), THRESHOLD)).toBe(404);
      expect(await threshold(w.item.s2)).toBeNull();
    },
  );

  it('a site of another project addressed through this project is 404 for item read and threshold update', async () => {
    expect(await status(w.admin, 'GET', invUrl(w.p1, w.x, w.item.x))).toBe(404);
    expect(await status(w.admin, 'PATCH', invUrl(w.p1, w.x, w.item.x), THRESHOLD)).toBe(404);
    expect(await threshold(w.item.x)).toBeNull();
  });
});

// ─── Inventory: tenant isolation ──────────────────────────────────────────────

describe('inventory list, item and threshold: tenant isolation', () => {
  it("another company's admin gets 404 on list, item and threshold update", async () => {
    expect(await inventoryStatuses(w.foreignAdmin, w.p1, w.s1, w.item.s1)).toEqual([404, 404, 404]);
    expect(await threshold(w.item.s1)).toBeNull();
  });

  it("another company's item addressed through our own site is 404 and stays unchanged", async () => {
    expect(await status(w.admin, 'GET', invUrl(w.p1, w.s1, w.item.y))).toBe(404);
    expect(await status(w.admin, 'PATCH', invUrl(w.p1, w.s1, w.item.y), THRESHOLD)).toBe(404);
    expect(await threshold(w.item.y)).toBeNull();
  });

  it("another company's site addressed through our own project is 404 for item read and threshold update", async () => {
    expect(await status(w.admin, 'GET', invUrl(w.p1, w.y, w.item.y))).toBe(404);
    expect(await status(w.admin, 'PATCH', invUrl(w.p1, w.y, w.item.y), THRESHOLD)).toBe(404);
    expect(await threshold(w.item.y)).toBeNull();
  });

  it('a request without a token gets 401 on list, item and threshold update', async () => {
    expect(await inventoryStatuses(null, w.p1, w.s1, w.item.s1)).toEqual([401, 401, 401]);
    expect(await threshold(w.item.s1)).toBeNull();
  });
});

// ─── Labour entry: roles ──────────────────────────────────────────────────────

describe('labour entry read, edit and delete: roles', () => {
  it.each(REFUSED_ROLES)('%s (a project member) gets 403 on read, edit and delete', async (role) => {
    expect(await labourStatuses(w.refused[role], w.p1, w.s1, w.entry.s1)).toEqual([403, 403, 403]);
    expect(await hours(w.entry.s1)).toBe(HOURS);
  });

  it('a finance officer reads an entry but cannot delete it (403)', async () => {
    expect(await status(w.fo, 'GET', labUrl(w.p1, w.s1, w.entry.s1))).toBe(200);
    expect(await status(w.fo, 'DELETE', labUrl(w.p1, w.s1, w.entry.s1))).toBe(403);
    expect(await hours(w.entry.s1)).toBe(HOURS);
  });
});

// ─── Labour entry: project and site scope ─────────────────────────────────────

describe('labour entry read, edit and delete: project and site scope', () => {
  it('a supervisor assigned to one site gets 404 reading or editing an entry of another site of the project', async () => {
    expect(await status(w.sup, 'GET', labUrl(w.p1, w.s1, w.entry.s1))).toBe(200);
    expect(await status(w.sup, 'GET', labUrl(w.p1, w.s2, w.entry.s2))).toBe(404);
    expect(await status(w.sup, 'PATCH', labUrl(w.p1, w.s2, w.entry.s2), EDIT)).toBe(404);
    expect(await hours(w.entry.s2)).toBe(HOURS);
  });

  it('a project manager who is not a member of the project gets 403 on read, edit and delete', async () => {
    expect(await labourStatuses(w.outsiderPm, w.p1, w.s1, w.entry.s1)).toEqual([403, 403, 403]);
    expect(await hours(w.entry.s1)).toBe(HOURS);
  });

  it('a project manager whose membership has ended gets 403 on read, edit and delete', async () => {
    expect(await labourStatuses(w.removedPm, w.p1, w.s1, w.entry.s1)).toEqual([403, 403, 403]);
    expect(await hours(w.entry.s1)).toBe(HOURS);
  });

  it.each(['admin', 'pm'] as const)(
    '%s: an entry addressed through another site of the same project is 404 for read, edit and delete',
    async (who) => {
      expect(await labourStatuses(w[who], w.p1, w.s1, w.entry.s2)).toEqual([404, 404, 404]);
      expect(await hours(w.entry.s2)).toBe(HOURS);
    },
  );

  it('an entry of another project addressed through this project is 404 for read, edit and delete', async () => {
    // Through a site of this project, and through its own site under this project.
    expect(await labourStatuses(w.admin, w.p1, w.s1, w.entry.x)).toEqual([404, 404, 404]);
    expect(await labourStatuses(w.admin, w.p1, w.x, w.entry.x)).toEqual([404, 404, 404]);
    expect(await hours(w.entry.x)).toBe(HOURS);
  });
});

// ─── Labour entry: tenant isolation ───────────────────────────────────────────

describe('labour entry read, edit and delete: tenant isolation', () => {
  it("another company's admin gets 404 on edit and delete", async () => {
    expect(await status(w.foreignAdmin, 'PATCH', labUrl(w.p1, w.s1, w.entry.s1), EDIT)).toBe(404);
    expect(await status(w.foreignAdmin, 'DELETE', labUrl(w.p1, w.s1, w.entry.s1))).toBe(404);
    expect(await hours(w.entry.s1)).toBe(HOURS);
  });

  it("another company's entry addressed through our own site is 404 and stays unchanged", async () => {
    expect(await labourStatuses(w.admin, w.p1, w.s1, w.entry.y)).toEqual([404, 404, 404]);
    expect(await hours(w.entry.y)).toBe(HOURS);
  });

  it('a request without a token gets 401 on read, edit and delete', async () => {
    expect(await labourStatuses(null, w.p1, w.s1, w.entry.s1)).toEqual([401, 401, 401]);
    expect(await hours(w.entry.s1)).toBe(HOURS);
  });

  it('none of the refused edits or deletes above wrote a labour audit row', async () => {
    const rows = await prisma.auditLog.count({
      where: { entityType: 'labour_entry', action: { in: ['update', 'delete'] } },
    });
    expect(rows).toBe(0);
  });

  it('positive control: the project manager on the project edits and then deletes the entry', async () => {
    expect(await status(w.pm, 'PATCH', labUrl(w.p1, w.s1, w.entry.s1), EDIT)).toBe(200);
    expect(await hours(w.entry.s1)).toBe(EDIT.hoursWorked);
    expect(await status(w.pm, 'DELETE', labUrl(w.p1, w.s1, w.entry.s1))).toBe(204);
    expect(await hours(w.entry.s1)).toBeNull();
  });
});
