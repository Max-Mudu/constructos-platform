/**
 * Pay-period lock (owner-approved 25 Nov 2026).
 *
 * A company has one "closed up to" date for labour and attendance. Labour
 * entries and attendance records dated on or before it cannot be created,
 * edited or deleted by anyone. Company admins and finance officers close
 * (forward only, up to yesterday); only company admins reopen (back only,
 * with a reason). Every close and reopen is kept in pay_period_locks and the
 * audit log. Existing records are never changed by a close or reopen.
 */
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server';
import { prisma } from '../src/utils/prisma';
import {
  createTestCompany,
  createTestUser,
  createTestProject,
  createTestSite,
  createTestWorker,
  assignWorkerToSite,
  assignUserToProject,
  createTestLabourEntry,
  createTestAttendanceRecord,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

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
});

/** "YYYY-MM-DD" for today + offset days (UTC, the @db.Date convention). */
function day(offset: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
const asDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

async function world(slug: string) {
  const { company, admin } = await createTestCompany(app, slug);
  const fo  = await createTestUser(app, company.id, 'finance_officer', `${slug}-fo`, { canViewFinance: true });
  const pm  = await createTestUser(app, company.id, 'project_manager', `${slug}-pm`, { canViewFinance: true });
  const sup = await createTestUser(app, company.id, 'site_supervisor', `${slug}-sup`);
  const viewer = await createTestUser(app, company.id, 'viewer', `${slug}-viewer`);
  const project = await createTestProject(company.id);
  const site    = await createTestSite(company.id, project.id);
  for (const u of [pm, sup, viewer]) await assignUserToProject(company.id, project.id, u.id);
  const worker  = await createTestWorker(company.id);
  await assignWorkerToSite(company.id, project.id, site.id, worker.id, admin.id);
  const base = `/api/v1/projects/${project.id}/sites/${site.id}`;
  return { company, admin, fo, pm, sup, viewer, project, site, worker, base };
}

function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, user: TestUser, payload?: object) {
  return app.inject({ method, url, headers: { authorization: `Bearer ${user.accessToken}` }, payload });
}
const close  = (u: TestUser, lockedThrough: string, reason?: string) =>
  call('POST', '/api/v1/pay-period-lock/close', u, { lockedThrough, ...(reason ? { reason } : {}) });
const reopen = (u: TestUser, lockedThrough: string | null, reason: string) =>
  call('POST', '/api/v1/pay-period-lock/reopen', u, { lockedThrough, reason });

// ─── Who may close and reopen ─────────────────────────────────────────────────

describe('close and reopen authorization', () => {
  it('company_admin and finance_officer may close; others are refused', async () => {
    const w = await world('ppl-auth-close');
    for (const u of [w.pm, w.sup, w.viewer]) {
      expect((await close(u, day(-10))).statusCode).toBe(403);
    }
    expect((await close(w.fo, day(-10))).statusCode).toBe(200);
    expect((await close(w.admin, day(-5))).statusCode).toBe(200);
  });

  it('only company_admin may reopen, and only with a reason', async () => {
    const w = await world('ppl-auth-reopen');
    await close(w.fo, day(-5));
    for (const u of [w.fo, w.pm, w.sup, w.viewer]) {
      expect((await reopen(u, day(-10), 'fix')).statusCode).toBe(403);
    }
    expect((await reopen(w.admin, day(-10), '')).statusCode).toBe(422);
    expect((await reopen(w.admin, day(-10), '   ')).statusCode).toBe(422);
    const ok = await reopen(w.admin, day(-10), 'Correct hours');
    expect(ok.statusCode).toBe(200);
    expect(ok.json().lock.lockedThrough).toBe(day(-10));
  });

  it('a close cannot cover today or move the date back; a reopen cannot move it forward', async () => {
    const w = await world('ppl-dates');
    expect((await close(w.fo, day(0))).statusCode).toBe(422);
    expect((await close(w.fo, day(3))).statusCode).toBe(422);
    expect((await reopen(w.admin, null, 'nothing closed')).statusCode).toBe(422);
    expect((await close(w.fo, day(-5))).statusCode).toBe(200);
    expect((await close(w.fo, day(-6))).statusCode).toBe(422);
    expect((await close(w.fo, day(-5))).statusCode).toBe(422);
    expect((await reopen(w.admin, day(-4), 'forward')).statusCode).toBe(422);
    const all = await reopen(w.admin, null, 'Reopen everything');
    expect(all.statusCode).toBe(200);
    expect(all.json().lock.lockedThrough).toBeNull();
  });

  it('labour viewers can read the date; another company is not affected', async () => {
    const w = await world('ppl-read');
    const other = await world('ppl-read-other');
    await close(w.fo, day(-5), 'Pay day');
    const mine = await call('GET', '/api/v1/pay-period-lock', w.sup);
    expect(mine.statusCode).toBe(200);
    expect(mine.json().lock.lockedThrough).toBe(day(-5));
    expect((await call('GET', '/api/v1/pay-period-lock', w.viewer)).statusCode).toBe(403);
    const theirs = await call('GET', '/api/v1/pay-period-lock', other.admin);
    expect(theirs.json().lock).toEqual({ lockedThrough: null, history: [] });
    // Their labour on the same date is unaffected.
    const res = await call('POST', `${other.base}/labour`, other.sup, { workerId: other.worker.id, date: day(-6), hoursWorked: 8 });
    expect(res.statusCode).toBe(201);
  });
});

// ─── Effects on labour ────────────────────────────────────────────────────────

describe('labour in a closed period', () => {
  it('cannot be created on or before the date, by any writing role; after it, as before', async () => {
    const w = await world('ppl-lab-create');
    await close(w.fo, day(-5));
    for (const [u, d] of [[w.sup, day(-6)], [w.pm, day(-5)], [w.admin, day(-30)]] as const) {
      const res = await call('POST', `${w.base}/labour`, u, { workerId: w.worker.id, date: d, hoursWorked: 8 });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('PAY_PERIOD_CLOSED');
      expect(res.json().error).toContain(day(-5));
    }
    expect(await prisma.labourEntry.count({ where: { companyId: w.company.id } })).toBe(0);
    const ok = await call('POST', `${w.base}/labour`, w.sup, { workerId: w.worker.id, date: day(-4), hoursWorked: 8 });
    expect(ok.statusCode).toBe(201);
  });

  it('cannot be edited or deleted, even by company_admin; the row is unchanged', async () => {
    const w = await world('ppl-lab-edit');
    const entry = await createTestLabourEntry(w.company.id, w.project.id, w.site.id, w.worker.id, w.admin.id,
      { date: asDate(day(-10)), hoursWorked: 8 });
    await close(w.fo, day(-5));

    const edit = await call('PATCH', `${w.base}/labour/${entry.id}`, w.admin, { hoursWorked: 4 });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().code).toBe('PAY_PERIOD_CLOSED');
    const del = await call('DELETE', `${w.base}/labour/${entry.id}`, w.admin);
    expect(del.statusCode).toBe(409);

    const row = await prisma.labourEntry.findUnique({ where: { id: entry.id } });
    expect(Number(row?.hoursWorked)).toBe(8);
    expect(await prisma.auditLog.count({ where: { entityType: 'labour_entry', entityId: entry.id } })).toBe(0);
  });

  it('after a reopen the entry can be corrected again', async () => {
    const w = await world('ppl-lab-reopen');
    const entry = await createTestLabourEntry(w.company.id, w.project.id, w.site.id, w.worker.id, w.admin.id,
      { date: asDate(day(-10)) });
    await close(w.fo, day(-5));
    await reopen(w.admin, day(-11), 'Correct hours for one worker');
    const edit = await call('PATCH', `${w.base}/labour/${entry.id}`, w.pm, { hoursWorked: 6 });
    expect(edit.statusCode).toBe(200);
  });

  it('an entry queued offline before the close and sent after it is refused with the reason', async () => {
    const w = await world('ppl-offline');
    // The Android queue replays the same POST it could not send while offline.
    const body = { workerId: w.worker.id, date: day(-8), hoursWorked: 8 };
    await close(w.fo, day(-5));
    const replay = await call('POST', `${w.base}/labour`, w.sup, body);
    expect(replay.statusCode).toBe(409);
    expect(replay.json()).toEqual(expect.objectContaining({ code: 'PAY_PERIOD_CLOSED' }));
    expect(replay.json().error).toMatch(/closed for payroll/);
  });
});

// ─── Effects on attendance ───────────────────────────────────────────────────

describe('attendance in a closed period', () => {
  it('cannot be created, edited or deleted on or before the date; after it, as before', async () => {
    const w = await world('ppl-att');
    const old = await createTestAttendanceRecord(w.company.id, w.project.id, w.site.id, w.worker.id, w.admin.id,
      { date: asDate(day(-10)), status: 'present' } as never);
    await close(w.fo, day(-5));

    const create = await call('POST', `${w.base}/attendance`, w.sup, { workerId: w.worker.id, date: day(-7), status: 'present' });
    expect(create.statusCode).toBe(409);
    expect(create.json().code).toBe('PAY_PERIOD_CLOSED');
    expect((await call('PATCH', `${w.base}/attendance/${old.id}`, w.sup, { status: 'absent' })).statusCode).toBe(409);
    expect((await call('DELETE', `${w.base}/attendance/${old.id}`, w.admin)).statusCode).toBe(409);
    expect((await prisma.attendanceRecord.findUnique({ where: { id: old.id } }))?.status).toBe('present');

    const after = await call('POST', `${w.base}/attendance`, w.sup, { workerId: w.worker.id, date: day(-3), status: 'present' });
    expect(after.statusCode).toBe(201);
    const recId = after.json().record.id;
    expect((await call('PATCH', `${w.base}/attendance/${recId}`, w.sup, { status: 'late' })).statusCode).toBe(200);
    expect((await call('DELETE', `${w.base}/attendance/${recId}`, w.pm)).statusCode).toBe(204);
  });
});

// ─── History and audit ────────────────────────────────────────────────────────

describe('close and reopen are recorded', () => {
  it('keeps every event with actor, dates and reason, and writes the audit log', async () => {
    const w = await world('ppl-audit');
    await close(w.fo, day(-10), 'November pay day');
    await close(w.admin, day(-5));
    await reopen(w.admin, day(-8), 'Hours correction for one worker');

    const { lock } = (await call('GET', '/api/v1/pay-period-lock', w.pm)).json();
    expect(lock.lockedThrough).toBe(day(-8));
    expect(lock.history.map((h: { action: string; lockedThrough: string; previousLockedThrough: string | null; createdById: string }) =>
      [h.action, h.lockedThrough, h.previousLockedThrough, h.createdById])).toEqual([
      ['reopen', day(-8),  day(-5),  w.admin.id],
      ['close',  day(-5),  day(-10), w.admin.id],
      ['close',  day(-10), null,     w.fo.id],
    ]);
    expect(lock.history[0].reason).toBe('Hours correction for one worker');

    const audits = await prisma.auditLog.findMany({
      where: { companyId: w.company.id, entityType: 'pay_period_lock' }, orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => [a.userId, a.changesBefore, a.changesAfter])).toEqual([
      [w.fo.id,    { lockedThrough: null },     { action: 'close',  lockedThrough: day(-10), reason: 'November pay day' }],
      [w.admin.id, { lockedThrough: day(-10) }, { action: 'close',  lockedThrough: day(-5),  reason: null }],
      [w.admin.id, { lockedThrough: day(-5) },  { action: 'reopen', lockedThrough: day(-8),  reason: 'Hours correction for one worker' }],
    ]);
  });

  it('a refused close by a role without permission is logged as permission_denied and changes nothing', async () => {
    const w = await world('ppl-denied');
    expect((await close(w.sup, day(-5))).statusCode).toBe(403);
    expect(await prisma.auditLog.count({ where: { userId: w.sup.id, action: 'permission_denied' } })).toBe(1);
    expect((await call('GET', '/api/v1/pay-period-lock', w.admin)).json().lock.lockedThrough).toBeNull();
  });
});

// ─── Concurrency ──────────────────────────────────────────────────────────────

describe('a close racing labour writes', () => {
  it('every write either committed before the close or was refused', async () => {
    const w = await world('ppl-race');
    const writes = Array.from({ length: 6 }, (_, i) =>
      call('POST', `${w.base}/labour`, w.sup, { workerId: w.worker.id, date: day(-1 - i), hoursWorked: 1 + i, notes: `race-${i}` }));
    const [closed, ...results] = await Promise.all([close(w.fo, day(-1)), ...writes]);
    expect(closed.statusCode).toBe(200);
    // Every date is covered by the close: a write either committed first (201)
    // or saw the new date (409). Nothing else, and the rows match the 201s.
    const created = results.filter((r) => r.statusCode === 201).length;
    expect(results.every((r) => r.statusCode === 201 || r.statusCode === 409)).toBe(true);
    expect(await prisma.labourEntry.count({ where: { companyId: w.company.id } })).toBe(created);
    // After the close, every later attempt is refused.
    const late = await call('POST', `${w.base}/labour`, w.sup, { workerId: w.worker.id, date: day(-20), hoursWorked: 1 });
    expect(late.statusCode).toBe(409);
  });
});
