/**
 * Attendance check-in / check-out order.
 *
 * A record is one worker on one site on one date; checkInTime and
 * checkOutTime are "HH:MM" on that date and the product has no overnight
 * shifts. A check-out earlier than the check-in is rejected with 422
 * VALIDATION_ERROR; equal times are allowed. A PATCH may send only one of the
 * two times (the web and mobile clients send just the changed field), so the
 * check uses the stored value of the other one, under a row lock, so two
 * concurrent single-field PATCHes cannot together produce an out-of-order pair.
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
  createTestAttendanceRecord,
  clearDatabase,
  TestUser,
} from './helpers/fixtures';

let app: FastifyInstance;

let admin: TestUser;
let supervisor: TestUser;
let workerUser: TestUser;
let companyId: string;
let projectId: string;
let siteId: string;
let selfWorkerId: string;
let day = 0;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  await clearDatabase();

  const a = await createTestCompany(app, 'att-order');
  companyId = a.company.id;
  admin = a.admin;
  const project = await createTestProject(companyId, 'P1');
  const site = await createTestSite(companyId, project.id, 'S1');
  projectId = project.id;
  siteId = site.id;

  supervisor = await createTestUser(app, companyId, 'site_supervisor', 'att-order-sup');
  await assignUserToProject(companyId, projectId, supervisor.id, siteId);

  const selfWorker = await createTestWorker(companyId);
  workerUser = await createTestUser(app, companyId, 'worker', 'att-order-wkr');
  await prisma.worker.update({ where: { id: selfWorker.id }, data: { userId: workerUser.id } });
  await assignWorkerToSite(companyId, projectId, siteId, selfWorker.id, admin.id);
  selfWorkerId = selfWorker.id;

  await Promise.all(Array.from({ length: 8 }, () => prisma.$queryRaw`SELECT 1`));
});

afterAll(async () => {
  await clearDatabase();
  await app.close();
  await prisma.$disconnect();
});

const BASE = `/api/v1/projects/__P__/sites/__S__/attendance`;
const base = () => BASE.replace('__P__', projectId).replace('__S__', siteId);

/** A worker on the site, so every test owns its records. */
async function newWorker(): Promise<string> {
  const w = await createTestWorker(companyId);
  await assignWorkerToSite(companyId, projectId, siteId, w.id, admin.id);
  return w.id;
}

function nextDate(): string {
  day += 1;
  return `2026-03-${String(day).padStart(2, '0')}`;
}

function create(body: Record<string, unknown>, user = supervisor) {
  return app.inject({
    method: 'POST', url: base(),
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: body,
  });
}

function patch(id: string, body: Record<string, unknown>, user = supervisor) {
  return app.inject({
    method: 'PATCH', url: `${base()}/${id}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: body,
  });
}

function self(body: Record<string, unknown>) {
  return app.inject({
    method: 'POST', url: `${base()}/self`,
    headers: { authorization: `Bearer ${workerUser.accessToken}` },
    payload: body,
  });
}

async function makeRecord(checkInTime?: string, checkOutTime?: string) {
  const workerId = await newWorker();
  return createTestAttendanceRecord(companyId, projectId, siteId, workerId, admin.id, {
    date: new Date(nextDate()),
    ...(checkInTime  && { checkInTime }),
    ...(checkOutTime && { checkOutTime }),
  });
}

async function stored(id: string) {
  return prisma.attendanceRecord.findUniqueOrThrow({
    where: { id }, select: { checkInTime: true, checkOutTime: true },
  });
}

function updateAudits(id: string) {
  return prisma.auditLog.count({ where: { entityType: 'attendance_record', entityId: id, action: 'update' } });
}

// ─── Create ───────────────────────────────────────────────────────────────────

describe('POST /attendance', () => {
  it('rejects a check-out earlier than the check-in with 422 and creates nothing', async () => {
    const workerId = await newWorker();
    const res = await create({ workerId, date: nextDate(), status: 'present', checkInTime: '17:00', checkOutTime: '07:30' });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(res.json().error).toMatch(/check-out time .*earlier than .*check-in time/i);
    expect(await prisma.attendanceRecord.count({ where: { workerId } })).toBe(0);
  });

  it('rejects a check-out one minute before the check-in', async () => {
    const workerId = await newWorker();
    const res = await create({ workerId, date: nextDate(), status: 'present', checkInTime: '08:00', checkOutTime: '07:59' });
    expect(res.statusCode).toBe(422);
  });

  it.each<[string, string]>([
    ['07:30', '17:00'],
    ['08:00', '08:00'],
    ['00:00', '23:59'],
    ['09:59', '10:00'],
  ])('accepts check-in %s with check-out %s', async (checkInTime, checkOutTime) => {
    const workerId = await newWorker();
    const res = await create({ workerId, date: nextDate(), status: 'present', checkInTime, checkOutTime });
    expect(res.statusCode).toBe(201);
    expect(res.json().record).toMatchObject({ checkInTime, checkOutTime });
  });

  it('accepts only one of the two times', async () => {
    const w1 = await newWorker();
    const w2 = await newWorker();
    expect((await create({ workerId: w1, date: nextDate(), status: 'present', checkInTime: '23:00' })).statusCode).toBe(201);
    expect((await create({ workerId: w2, date: nextDate(), status: 'present', checkOutTime: '00:30' })).statusCode).toBe(201);
  });
});

// ─── Update ───────────────────────────────────────────────────────────────────

describe('PATCH /attendance/:id', () => {
  it('rejects a check-out alone that is earlier than the stored check-in, leaving the record unchanged', async () => {
    const rec = await makeRecord('08:00');
    const res = await patch(rec.id, { checkOutTime: '07:00' });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(await stored(rec.id)).toEqual({ checkInTime: '08:00', checkOutTime: null });
    expect(await updateAudits(rec.id)).toBe(0);
  });

  it('rejects a check-in alone that is later than the stored check-out', async () => {
    const rec = await makeRecord('07:30', '12:00');
    const res = await patch(rec.id, { checkInTime: '13:00' });
    expect(res.statusCode).toBe(422);
    expect(await stored(rec.id)).toEqual({ checkInTime: '07:30', checkOutTime: '12:00' });
  });

  it('rejects an out-of-order pair sent together', async () => {
    const rec = await makeRecord('07:30', '17:00');
    const res = await patch(rec.id, { checkInTime: '18:00', checkOutTime: '06:00' });
    expect(res.statusCode).toBe(422);
    expect(await stored(rec.id)).toEqual({ checkInTime: '07:30', checkOutTime: '17:00' });
  });

  it('accepts moving both times together when the new pair is in order, even past the old values', async () => {
    const rec = await makeRecord('07:30', '12:00');
    const res = await patch(rec.id, { checkInTime: '13:00', checkOutTime: '18:00' });
    expect(res.statusCode).toBe(200);
    expect(await stored(rec.id)).toEqual({ checkInTime: '13:00', checkOutTime: '18:00' });
  });

  it('accepts a check-out equal to the stored check-in', async () => {
    const rec = await makeRecord('08:00');
    const res = await patch(rec.id, { checkOutTime: '08:00' });
    expect(res.statusCode).toBe(200);
    expect(res.json().record.checkOutTime).toBe('08:00');
  });

  it('accepts a later check-out (the mobile check-out button) and writes one audit row', async () => {
    const rec = await makeRecord('07:30');
    const res = await patch(rec.id, { checkOutTime: '17:00' });
    expect(res.statusCode).toBe(200);
    expect(await stored(rec.id)).toEqual({ checkInTime: '07:30', checkOutTime: '17:00' });
    expect(await updateAudits(rec.id)).toBe(1);
  });

  it('clearing the check-in lets any check-out stand, and clearing the check-out lets any check-in stand', async () => {
    const rec = await makeRecord('07:30', '12:00');
    expect((await patch(rec.id, { checkInTime: null })).statusCode).toBe(200);
    expect((await patch(rec.id, { checkOutTime: null, checkInTime: '15:00' })).statusCode).toBe(200);
    expect(await stored(rec.id)).toEqual({ checkInTime: '15:00', checkOutTime: null });
  });

  it('a status or notes change on a record without times is unaffected', async () => {
    const rec = await makeRecord();
    const res = await patch(rec.id, { status: 'absent', notes: 'sick' });
    expect(res.statusCode).toBe(200);
  });

  it('a status or notes change is still accepted on an older record whose stored times are out of order', async () => {
    // Records saved before this rule existed can hold a check-out earlier than the check-in.
    const rec = await makeRecord('09:00', '07:00');
    const res = await patch(rec.id, { status: 'late', notes: 'corrected status' });
    expect(res.statusCode).toBe(200);
    expect(await stored(rec.id)).toEqual({ checkInTime: '09:00', checkOutTime: '07:00' });
    // Changing one of its times is still checked against the other.
    expect((await patch(rec.id, { checkOutTime: '08:00' })).statusCode).toBe(422);
    expect((await patch(rec.id, { checkOutTime: '17:00' })).statusCode).toBe(200);
  });

  it('an unknown record is still a 404', async () => {
    const res = await patch('00000000-0000-4000-8000-000000000000', { checkOutTime: '07:00' });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Concurrency ──────────────────────────────────────────────────────────────

describe('concurrent single-field PATCHes', () => {
  it('a later check-in and an earlier check-out sent at once never leave the record out of order', async () => {
    for (let i = 0; i < 6; i++) {
      const rec = await makeRecord('08:00');
      // Each request alone is valid against the stored record: check-in
      // 15:00 with no check-out, and check-out 10:00 after check-in 08:00.
      const [rIn, rOut] = await Promise.all([
        patch(rec.id, { checkInTime: '15:00' }),
        patch(rec.id, { checkOutTime: '10:00' }, admin),
      ]);
      expect([rIn.statusCode, rOut.statusCode].sort()).toEqual([200, 422]);

      const row = await stored(rec.id);
      if (row.checkInTime && row.checkOutTime) {
        expect(row.checkOutTime >= row.checkInTime).toBe(true);
      }
      expect(await updateAudits(rec.id)).toBe(1);
    }
  });

  it('many concurrent check-outs against one check-in keep only in-order values', async () => {
    const rec = await makeRecord('12:00');
    const outs = ['11:00', '12:00', '13:00', '09:30', '16:45', '11:59'];
    const results = await Promise.all(outs.map((o, i) => patch(rec.id, { checkOutTime: o }, i % 2 ? admin : supervisor)));
    expect(results.map((r) => r.statusCode)).toEqual(outs.map((o) => (o >= '12:00' ? 200 : 422)));
    const row = await stored(rec.id);
    expect(['12:00', '13:00', '16:45']).toContain(row.checkOutTime);
  });
});

// ─── Worker self check-in ─────────────────────────────────────────────────────

describe('POST /attendance/self', () => {
  it('a re-submitted check-in later than the recorded check-out is rejected; an earlier one is accepted', async () => {
    const first = await self({ checkInTime: '07:15' });
    expect(first.statusCode).toBe(201);
    const id = first.json().record.id as string;
    expect(first.json().record.workerId).toBe(selfWorkerId);

    expect((await patch(id, { checkOutTime: '12:00' })).statusCode).toBe(200);

    const late = await self({ checkInTime: '13:00' });
    expect(late.statusCode).toBe(422);
    expect(late.json().code).toBe('VALIDATION_ERROR');
    expect(await stored(id)).toEqual({ checkInTime: '07:15', checkOutTime: '12:00' });

    const fixed = await self({ checkInTime: '07:45' });
    expect(fixed.statusCode).toBe(201);
    expect(await stored(id)).toEqual({ checkInTime: '07:45', checkOutTime: '12:00' });

    const equal = await self({ checkInTime: '12:00' });
    expect(equal.statusCode).toBe(201);
  });
});
