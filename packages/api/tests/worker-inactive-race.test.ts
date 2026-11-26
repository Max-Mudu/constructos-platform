/**
 * Recording work while the same worker is being deactivated.
 *
 * Invariant: no new attendance record, labour entry or self check-in commits
 * after a deactivation of that worker has taken effect. A booking already in
 * progress may finish first (the deactivation then waits for it); a booking
 * that reaches the worker after the deactivation is refused with 422
 * WORKER_INACTIVE.
 *
 *  1. Deterministic interleaving through the real routes: the booking is held
 *     just before it writes its row (a test transaction blocks inserts into the
 *     table) while the company admin deactivates the worker.
 *  2. Repeated concurrent runs: deactivation and booking are started together
 *     many times. The deactivation, inside its own transaction, counts the
 *     worker's rows right after its update; the invariant is that no row
 *     appears after that count.
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

interface World {
  companyId: string;
  projectId: string;
  siteId: string;
  admin: TestUser;
  sup: TestUser;
}

let w: World;

beforeEach(async () => {
  await clearDatabase();
  const { company, admin } = await createTestCompany(app, 'inact-race');
  const project = await createTestProject(company.id);
  const site    = await createTestSite(company.id, project.id);
  const sup     = await createTestUser(app, company.id, 'site_supervisor', 'inact-race-sup');
  await assignUserToProject(company.id, project.id, sup.id, site.id);
  w = { companyId: company.id, projectId: project.id, siteId: site.id, admin, sup };
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function req(user: TestUser, method: 'POST' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    ...(payload && { payload }),
  });
}

type Kind = 'attendance' | 'labour' | 'self';
const TABLE: Record<Kind, 'attendance_records' | 'labour_entries'> = {
  attendance: 'attendance_records',
  labour:     'labour_entries',
  self:       'attendance_records',
};

let seq = 0;

/** An active worker assigned to the site, plus (for 'self') a linked worker login. */
async function bookableWorker(kind: Kind): Promise<{ workerId: string; booker: TestUser }> {
  seq += 1;
  const worker = await createTestWorker(w.companyId, { firstName: `Race${seq}`, dailyWage: 1000 });
  await assignWorkerToSite(w.companyId, w.projectId, w.siteId, worker.id, w.admin.id);
  if (kind !== 'self') return { workerId: worker.id, booker: w.sup };
  const user = await createTestUser(app, w.companyId, 'worker', `inact-race-${seq}`);
  await prisma.worker.update({ where: { id: worker.id }, data: { userId: user.id } });
  return { workerId: worker.id, booker: user };
}

function book(kind: Kind, workerId: string, booker: TestUser) {
  const base = `/projects/${w.projectId}/sites/${w.siteId}`;
  if (kind === 'attendance') return req(booker, 'POST', `${base}/attendance`, { workerId, date: '2026-11-20', status: 'present' });
  if (kind === 'labour')     return req(booker, 'POST', `${base}/labour`, { workerId, date: '2026-11-20', hoursWorked: 8 });
  return req(booker, 'POST', `${base}/attendance/self`, { checkInTime: '07:00' });
}

function rowsFor(kind: Kind, workerId: string): Promise<number> {
  return kind === 'labour'
    ? prisma.labourEntry.count({ where: { workerId } })
    : prisma.attendanceRecord.count({ where: { workerId } });
}

async function waitUntil(what: string, cond: () => Promise<boolean>, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting until ${what}`);
}

/** A session of this database is waiting for a lock on `table`. */
async function insertWaitingOn(table: string): Promise<boolean> {
  const [row] = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pg_locks l
    JOIN pg_class c ON c.oid = l.relation
    WHERE l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND c.relname = ${table} AND NOT l.granted`;
  return (row?.n ?? 0) > 0;
}

/** A session of this database is waiting for another transaction to end (a row lock). */
async function rowLockWaiting(): Promise<boolean> {
  const [row] = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM pg_locks l
    JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE a.datname = current_database() AND l.locktype = 'transactionid' AND NOT l.granted`;
  return (row?.n ?? 0) > 0;
}

/** Holds a lock that blocks inserts into `table` until release() is called. */
async function holdInserts(table: string): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  const released = new Promise<void>((r) => { release = r; });
  let locked!: () => void;
  const isLocked = new Promise<void>((r) => { locked = r; });
  const holder = prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`LOCK TABLE "${table}" IN SHARE MODE`);
    locked();
    await released;
  }, { timeout: 30000, maxWait: 10000 });
  await Promise.race([isLocked, holder]);
  return { release: async () => { release(); await holder; } };
}

// ─── 1. Deterministic interleavings ───────────────────────────────────────────

describe('a deactivation while a booking is being written', () => {
  it.each(['attendance', 'labour', 'self'] as Kind[])(
    '%s: the booking already holding the worker finishes first; nothing commits after the deactivation',
    async (kind) => {
      const { workerId, booker } = await bookableWorker(kind);
      const gate = await holdInserts(TABLE[kind]);

      let booking: ReturnType<typeof book> | undefined;
      let deactivationSettled = false;
      try {
        booking = book(kind, workerId, booker);
        // The booking has read the worker and is now waiting to insert its row.
        await waitUntil('the booking waits to insert', () => insertWaitingOn(TABLE[kind]));

        const deactivation = req(w.admin, 'DELETE', `/workers/${workerId}`)
          .then((res) => { deactivationSettled = true; return res; });
        // Either the deactivation completes, or it is waiting for the booking.
        await waitUntil('the deactivation completes or waits', async () => deactivationSettled || rowLockWaiting());
        const deactivatedBeforeBookingCommitted = deactivationSettled;

        await gate.release();
        const [bookingRes, deactivationRes] = await Promise.all([booking, deactivation]);

        // Invariant: a booking that commits after the deactivation took effect must not succeed.
        expect({ deactivatedBeforeBookingCommitted, bookingStatus: bookingRes.statusCode })
          .not.toEqual({ deactivatedBeforeBookingCommitted: true, bookingStatus: 201 });

        // With the worker row locked by the booking, the deactivation waits for it.
        expect(deactivatedBeforeBookingCommitted).toBe(false);
        expect(bookingRes.statusCode).toBe(201);
        expect(deactivationRes.statusCode).toBe(204);
        expect(await rowsFor(kind, workerId)).toBe(1);
        expect((await prisma.worker.findUniqueOrThrow({ where: { id: workerId } })).isActive).toBe(false);
      } finally {
        await gate.release().catch(() => undefined);
        await booking?.catch(() => undefined);
      }
    },
  );

  it.each(['attendance', 'labour', 'self'] as Kind[])(
    '%s: a booking that starts while a deactivation is being saved waits for it and is refused',
    async (kind) => {
      const { workerId, booker } = await bookableWorker(kind);

      let commit!: () => void;
      const committed = new Promise<void>((r) => { commit = r; });
      let updated!: () => void;
      const isUpdated = new Promise<void>((r) => { updated = r; });
      // Same change as DELETE /workers/:id, held open before its commit.
      const deactivation = prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          UPDATE "workers" SET "isActive" = false, "employmentStatus" = 'inactive', "updatedAt" = now()
          WHERE "id" = ${workerId}`;
        updated();
        await committed;
      }, { timeout: 30000, maxWait: 10000 });
      await Promise.race([isUpdated, deactivation]);

      let bookingSettled = false;
      const booking = book(kind, workerId, booker).then((res) => { bookingSettled = true; return res; });
      try {
        await waitUntil('the booking completes or waits', async () => bookingSettled || rowLockWaiting());
        commit();
        await deactivation;
        const res = await booking;
        expect(res.statusCode).toBe(422);
        expect(res.json().code).toBe('WORKER_INACTIVE');
        expect(await rowsFor(kind, workerId)).toBe(0);
      } finally {
        commit();
        await deactivation.catch(() => undefined);
        await booking.catch(() => undefined);
      }
    },
  );
});

// ─── 2. Repeated concurrent runs ──────────────────────────────────────────────

const RUNS = 30;

describe('deactivation and booking started together, many times', () => {
  it.each(['attendance', 'labour', 'self'] as Kind[])(
    `%s: over ${RUNS} runs no row appears after the deactivation took effect`,
    async (kind) => {
      const outcomes = { created: 0, refused: 0 };
      const violations: string[] = [];

      for (let i = 0; i < RUNS; i += 1) {
        const { workerId, booker } = await bookableWorker(kind);
        const bookingDelay      = i % 2 === 0 ? i % 4 : 0;
        const deactivationDelay = i % 2 === 1 ? i % 4 : 0;

        // The deactivation's update, then (same transaction, after the update)
        // the rows the deactivation can see: everything committed before it.
        const deactivation = (async () => {
          await sleep(deactivationDelay);
          return prisma.$transaction(async (tx) => {
            await tx.$executeRaw`
              UPDATE "workers" SET "isActive" = false, "employmentStatus" = 'inactive', "updatedAt" = now()
              WHERE "id" = ${workerId}`;
            const [row] = kind === 'labour'
              ? await tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "labour_entries" WHERE "workerId" = ${workerId}`
              : await tx.$queryRaw<Array<{ n: number }>>`SELECT count(*)::int AS n FROM "attendance_records" WHERE "workerId" = ${workerId}`;
            return row?.n ?? 0;
          }, { timeout: 15000, maxWait: 10000 });
        })();
        const booking = (async () => {
          await sleep(bookingDelay);
          return book(kind, workerId, booker);
        })();

        const [seenByDeactivation, res] = await Promise.all([deactivation, booking]);
        if (res.statusCode === 201) outcomes.created += 1;
        else if (res.statusCode === 422 && res.json().code === 'WORKER_INACTIVE') outcomes.refused += 1;
        else violations.push(`run ${i}: unexpected ${res.statusCode} ${res.body}`);

        const finalRows = await rowsFor(kind, workerId);
        if (finalRows !== seenByDeactivation) {
          violations.push(`run ${i}: ${finalRows - seenByDeactivation} row(s) committed after the deactivation`);
        }
      }

      expect(violations).toEqual([]);
      expect(outcomes.created + outcomes.refused).toBe(RUNS);
    },
  );

  it(`labour: ${RUNS} runs through DELETE /workers/:id end without errors and with the worker inactive`, async () => {
    for (let i = 0; i < RUNS; i += 1) {
      const { workerId, booker } = await bookableWorker('labour');
      const [del, res] = await Promise.all([
        (async () => { await sleep(i % 3); return req(w.admin, 'DELETE', `/workers/${workerId}`); })(),
        (async () => { await sleep((i + 1) % 3); return book('labour', workerId, booker); })(),
      ]);
      expect(del.statusCode).toBe(204);
      expect([201, 422]).toContain(res.statusCode);
      if (res.statusCode === 422) expect(res.json().code).toBe('WORKER_INACTIVE');
      expect(await rowsFor('labour', workerId)).toBe(res.statusCode === 201 ? 1 : 0);
      expect((await prisma.worker.findUniqueOrThrow({ where: { id: workerId } })).isActive).toBe(false);
    }
  });
});
