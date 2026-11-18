/**
 * Access-scope regression tests for ids taken from the URL or request body:
 * a child id is resolved only inside its parent from the URL and inside the
 * caller's company, and per-user records only for their owner. Every refusal
 * leaves the stored rows unchanged.
 *
 *  - budget line items / variations under /budgets/:budgetId
 *  - drawing revisions under /drawings/:drawingId
 *  - PATCH /auth/me/defaults (project + site must be the caller's company and match)
 *  - project members: target user and site must be in the company / project
 *  - notifications and push tokens: owner only
 *  - activity feed: own company only, restricted roles
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
  createTestBudget,
  createTestLineItem,
  createTestDrawing,
  createTestRevision,
  createTestNotification,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

interface World {
  adminA: TestUser; foA: TestUser; pmA: TestUser; supA: TestUser; viewerA: TestUser; workerA: TestUser;
  adminB: TestUser; foB: TestUser;
  pA1: string; sA1: string; pA2: string; sA2: string;
  pB: string; sB: string;
  budA1: string; budA2: string; liA1: string; liA2: string; voA2: string;
  dA1: string; dA1b: string; rA1: string; rA1b: string;
  notifA: string; notifB: string;
}
let w: World;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'nested-a');
  const b = await createTestCompany(app, 'nested-b');
  const ca = a.company.id;
  const cb = b.company.id;

  const foA     = await createTestUser(app, ca, 'finance_officer', 'nid-fo', { canViewFinance: true });
  const pmA     = await createTestUser(app, ca, 'project_manager', 'nid-pm', { canViewFinance: true });
  const supA    = await createTestUser(app, ca, 'site_supervisor', 'nid-sup');
  const viewerA = await createTestUser(app, ca, 'viewer', 'nid-viewer');
  const workerA = await createTestUser(app, ca, 'worker', 'nid-worker');
  const foB     = await createTestUser(app, cb, 'finance_officer', 'nid-fob', { canViewFinance: true });

  const pA1 = await createTestProject(ca, 'NID-A1');
  const sA1 = await createTestSite(ca, pA1.id, 'NID-A1-S');
  const pA2 = await createTestProject(ca, 'NID-A2');
  const sA2 = await createTestSite(ca, pA2.id, 'NID-A2-S');
  const pB  = await createTestProject(cb, 'NID-B');
  const sB  = await createTestSite(cb, pB.id, 'NID-B-S');

  await assignUserToProject(ca, pA1.id, pmA.id);
  await assignUserToProject(ca, pA1.id, supA.id, sA1.id);

  const budA1 = await createTestBudget(ca, pA1.id);
  const budA2 = await createTestBudget(ca, pA2.id);
  const liA1  = await createTestLineItem(budA1.id, ca, pA1.id, { description: 'A1 line' });
  const liA2  = await createTestLineItem(budA2.id, ca, pA2.id, { description: 'A2 line' });
  const voA2  = await prisma.variationOrder.create({
    data: {
      budgetId: budA2.id, companyId: ca, projectId: pA2.id, referenceNumber: 'NID-VO-A2',
      description: 'A2 variation', amount: 50, direction: 'addition', status: 'pending', requestedById: foA.id,
    },
  });

  const dA1  = await createTestDrawing(ca, pA1.id, a.admin.id, { title: 'NID drawing 1' });
  const dA1b = await createTestDrawing(ca, pA1.id, a.admin.id, { title: 'NID drawing 2' });
  const rA1  = await createTestRevision(dA1.id, ca, a.admin.id, { revisionNumber: 'A' });
  const rA1b = await createTestRevision(dA1b.id, ca, a.admin.id, { revisionNumber: 'B' });

  const notifA = await createTestNotification(ca, pmA.id, { title: 'for pmA' });
  const notifB = await createTestNotification(cb, foB.id, { title: 'for foB' });

  await prisma.pushToken.create({
    data: { userId: pmA.id, companyId: ca, token: 'ExponentPushToken[nid-pm-a]', platform: 'expo' },
  });

  await prisma.auditLog.create({
    data: { companyId: cb, userId: foB.id, userEmail: foB.email, userRole: 'finance_officer',
      action: 'create', entityType: 'nid_marker_b', entityId: 'nid-b' },
  });

  w = {
    adminA: a.admin, foA, pmA, supA, viewerA, workerA, adminB: b.admin, foB,
    pA1: pA1.id, sA1: sA1.id, pA2: pA2.id, sA2: sA2.id, pB: pB.id, sB: sB.id,
    budA1: budA1.id, budA2: budA2.id, liA1: liA1.id, liA2: liA2.id, voA2: voA2.id,
    dA1: dA1.id, dA1b: dA1b.id, rA1: rA1.id, rA1b: rA1b.id,
    notifA: notifA.id, notifB: notifB.id,
  };
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

function req(user: TestUser, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    ...(payload && { payload }),
  });
}

// ─── Budgets: child ids are resolved inside the budget from the URL ───────────

describe('budget line items and variations are bound to the budget in the URL', () => {
  it('PATCH a line item of another budget through this budget: 404, unchanged', async () => {
    const res = await req(w.foA, 'PATCH', `/budgets/${w.budA1}/line-items/${w.liA2}`, { description: 'moved' });
    expect(res.statusCode).toBe(404);
    const row = await prisma.budgetLineItem.findUniqueOrThrow({ where: { id: w.liA2 } });
    expect(row.description).toBe('A2 line');
  });

  it('DELETE a line item of another budget through this budget: 404, row kept', async () => {
    const res = await req(w.foA, 'DELETE', `/budgets/${w.budA1}/line-items/${w.liA2}`);
    expect(res.statusCode).toBe(404);
    expect(await prisma.budgetLineItem.count({ where: { id: w.liA2 } })).toBe(1);
  });

  it('PATCH a variation of another budget through this budget: 404, unchanged', async () => {
    const res = await req(w.foA, 'PATCH', `/budgets/${w.budA1}/variations/${w.voA2}`, { status: 'approved' });
    expect(res.statusCode).toBe(404);
    const row = await prisma.variationOrder.findUniqueOrThrow({ where: { id: w.voA2 } });
    expect(row.status).toBe('pending');
  });

  it('PM: line item of a project budget they are not a member of: 404, unchanged', async () => {
    const res = await req(w.pmA, 'PATCH', `/budgets/${w.budA2}/line-items/${w.liA2}`, { description: 'pm edit' });
    expect(res.statusCode).toBe(404);
    const row = await prisma.budgetLineItem.findUniqueOrThrow({ where: { id: w.liA2 } });
    expect(row.description).toBe('A2 line');
  });

  it('another company: line item and budget are 404, unchanged', async () => {
    const r1 = await req(w.foB, 'PATCH', `/budgets/${w.budA1}/line-items/${w.liA1}`, { description: 'b edit' });
    const r2 = await req(w.foB, 'GET', `/budgets/${w.budA1}`);
    expect(r1.statusCode).toBe(404);
    expect(r2.statusCode).toBe(404);
    const row = await prisma.budgetLineItem.findUniqueOrThrow({ where: { id: w.liA1 } });
    expect(row.description).toBe('A1 line');
  });

  it('control: the correct budget/line-item pair is editable', async () => {
    const res = await req(w.foA, 'PATCH', `/budgets/${w.budA1}/line-items/${w.liA1}`, { notes: 'ok' });
    expect(res.statusCode).toBe(200);
  });
});

// ─── Drawings: revision ids are resolved inside the drawing from the URL ─────

describe('drawing revisions are bound to the drawing in the URL', () => {
  it('approve a revision of another drawing through this drawing: 404, unchanged', async () => {
    const res = await req(w.adminA, 'POST', `/projects/${w.pA1}/drawings/${w.dA1}/revisions/${w.rA1b}/approve`, {});
    expect(res.statusCode).toBe(404);
    const rev = await prisma.drawingRevision.findUniqueOrThrow({ where: { id: w.rA1b } });
    expect(rev.status).toBe('draft');
    const drawing = await prisma.drawing.findUniqueOrThrow({ where: { id: w.dA1 } });
    expect(drawing.currentRevisionId).toBeNull();
  });

  it('comments of a revision of another drawing through this drawing: 404', async () => {
    const list = await req(w.adminA, 'GET', `/projects/${w.pA1}/drawings/${w.dA1}/revisions/${w.rA1b}/comments`);
    const add  = await req(w.adminA, 'POST', `/projects/${w.pA1}/drawings/${w.dA1}/revisions/${w.rA1b}/comments`, { text: 'x' });
    expect(list.statusCode).toBe(404);
    expect(add.statusCode).toBe(404);
    expect(await prisma.drawingComment.count({ where: { revisionId: w.rA1b } })).toBe(0);
  });

  it('a drawing of this company under another company\'s project id: 404', async () => {
    const res = await req(w.adminB, 'GET', `/projects/${w.pA1}/drawings/${w.dA1}`);
    expect(res.statusCode).toBe(404);
  });

  it('a drawing under a different project of the same company: 404', async () => {
    const res = await req(w.adminA, 'GET', `/projects/${w.pA2}/drawings/${w.dA1}`);
    expect(res.statusCode).toBe(404);
  });
});

// ─── Own defaults ────────────────────────────────────────────────────────────

describe('PATCH /auth/me/defaults only accepts a project and site of the caller\'s company that match', () => {
  async function defaults(user: TestUser) {
    return prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { defaultProjectId: true, defaultSiteId: true } });
  }

  it('another company\'s project and site: 404, unchanged', async () => {
    const before = await defaults(w.pmA);
    const res = await req(w.pmA, 'PATCH', '/auth/me/defaults', { defaultProjectId: w.pB, defaultSiteId: w.sB });
    expect(res.statusCode).toBe(404);
    expect(await defaults(w.pmA)).toEqual(before);
  });

  it('own project with a site of another project: 404, unchanged', async () => {
    const before = await defaults(w.pmA);
    const res = await req(w.pmA, 'PATCH', '/auth/me/defaults', { defaultProjectId: w.pA1, defaultSiteId: w.sA2 });
    expect(res.statusCode).toBe(404);
    expect(await defaults(w.pmA)).toEqual(before);
  });

  it('own project with another company\'s site: 404, unchanged', async () => {
    const before = await defaults(w.pmA);
    const res = await req(w.pmA, 'PATCH', '/auth/me/defaults', { defaultProjectId: w.pA1, defaultSiteId: w.sB });
    expect(res.statusCode).toBe(404);
    expect(await defaults(w.pmA)).toEqual(before);
  });

  it('a saved default never grants access to a project the user is not a member of', async () => {
    const set = await req(w.pmA, 'PATCH', '/auth/me/defaults', { defaultProjectId: w.pA2, defaultSiteId: w.sA2 });
    expect(set.statusCode).toBe(200);
    const res = await req(w.pmA, 'GET', `/projects/${w.pA2}`);
    expect(res.statusCode).toBe(403);
    await req(w.pmA, 'PATCH', '/auth/me/defaults', { defaultProjectId: null, defaultSiteId: null });
  });
});

// ─── Project members ─────────────────────────────────────────────────────────

describe('POST /projects/:projectId/members validates the target user and site', () => {
  it('a user of another company: 404, no membership written', async () => {
    const res = await req(w.adminA, 'POST', `/projects/${w.pA1}/members`, { userId: w.foB.id });
    expect(res.statusCode).toBe(404);
    expect(await prisma.projectMember.count({ where: { userId: w.foB.id } })).toBe(0);
  });

  it('a site of another project: 404, no membership written', async () => {
    const res = await req(w.adminA, 'POST', `/projects/${w.pA1}/members`, { userId: w.viewerA.id, siteId: w.sA2 });
    expect(res.statusCode).toBe(404);
    expect(await prisma.projectMember.count({ where: { userId: w.viewerA.id } })).toBe(0);
  });

  it('another company\'s admin cannot add to this project: 404, no membership written', async () => {
    const res = await req(w.adminB, 'POST', `/projects/${w.pA1}/members`, { userId: w.viewerA.id });
    expect(res.statusCode).toBe(404);
    expect(await prisma.projectMember.count({ where: { userId: w.viewerA.id } })).toBe(0);
  });

  it('another company\'s admin cannot remove a member of this project: 404, membership kept', async () => {
    const res = await req(w.adminB, 'DELETE', `/projects/${w.pA1}/members/${w.pmA.id}`);
    expect(res.statusCode).toBe(404);
    expect(await prisma.projectMember.count({ where: { userId: w.pmA.id, projectId: w.pA1, removedAt: null } })).toBe(1);
  });
});

// ─── Per-user records ────────────────────────────────────────────────────────

describe('notifications and push tokens belong to their owner only', () => {
  it('another user\'s notification cannot be read, marked or deleted', async () => {
    const mark = await req(w.foA, 'POST', `/notifications/${w.notifA}/read`);
    const del  = await req(w.foA, 'DELETE', `/notifications/${w.notifA}`);
    const markB = await req(w.foA, 'POST', `/notifications/${w.notifB}/read`);
    expect(mark.statusCode).toBe(404);
    expect(del.statusCode).toBe(404);
    expect(markB.statusCode).toBe(404);
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: w.notifA } });
    expect(row.isRead).toBe(false);
    const list = await req(w.foA, 'GET', '/notifications');
    expect(list.body).not.toContain(w.notifA);
    expect(list.body).not.toContain(w.notifB);
  });

  it('another user\'s push token cannot be removed', async () => {
    const res = await req(w.foA, 'DELETE', `/notifications/push-token/${encodeURIComponent('ExponentPushToken[nid-pm-a]')}`);
    expect(res.statusCode).toBe(204);
    expect(await prisma.pushToken.count({ where: { token: 'ExponentPushToken[nid-pm-a]', userId: w.pmA.id } })).toBe(1);
  });
});

// ─── Activity feed ───────────────────────────────────────────────────────────

describe('GET /activity is limited to the caller\'s company and to the permitted roles', () => {
  it('finance_officer sees no other company\'s entries', async () => {
    const res = await req(w.foA, 'GET', '/activity?limit=100');
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('nid_marker_b');
  });

  it.each([
    ['site_supervisor', () => w.supA],
    ['viewer', () => w.viewerA],
    ['worker', () => w.workerA],
  ])('%s: 403', async (_label, who) => {
    const res = await req(who(), 'GET', '/activity');
    expect(res.statusCode).toBe(403);
  });
});
