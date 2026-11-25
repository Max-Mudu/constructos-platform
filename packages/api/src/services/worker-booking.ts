import { Prisma, WorkerEmploymentStatus } from '@prisma/client';
import { AppError, ForbiddenError, NotFoundError } from '../utils/errors';

// ─── Recording work for a worker ──────────────────────────────────────────────
//
// New attendance records and labour entries (including a worker's own
// check-in) are recorded only for an ACTIVE worker: isActive is true AND the
// employment status is 'active' (the same rule the dashboard uses to count
// active workers). A deactivated, inactive or suspended worker is refused with
// 422 WORKER_INACTIVE. Records that already exist are not affected: they stay
// readable and editable, and deactivating a worker changes no attendance,
// labour or audit row.
//
// The status is read with the worker row locked (FOR SHARE) inside the same
// transaction that writes the new record. A deactivation updates that row, so
// it waits for a booking in progress to commit, and a booking waits for a
// deactivation in progress and then reads the new status. A booking therefore
// never commits after a deactivation of the same worker has committed.

export class WorkerInactiveError extends AppError {
  constructor(message = 'This worker is inactive, so new attendance or labour cannot be recorded for them') {
    super(422, message, 'WORKER_INACTIVE');
  }
}

export function isWorkerActive(worker: { isActive: boolean; employmentStatus: WorkerEmploymentStatus }): boolean {
  return worker.isActive && worker.employmentStatus === 'active';
}

const BOOKING_WORKER_SELECT = {
  id:               true,
  isActive:         true,
  employmentStatus: true,
  dailyWage:        true,
  currency:         true,
} as const;

export type BookingWorker = Prisma.WorkerGetPayload<{ select: typeof BOOKING_WORKER_SELECT }>;

/**
 * Locks the company's worker row for the rest of the transaction (FOR SHARE:
 * other bookings of the same worker still run in parallel) and returns it, or
 * null when no such worker exists in the company. Identify the worker by id,
 * or by the linked user account for a worker's own check-in.
 */
export async function lockWorkerForBooking(
  tx: Prisma.TransactionClient,
  by: { workerId: string; companyId: string } | { userId: string; companyId: string },
): Promise<BookingWorker | null> {
  const locked = 'workerId' in by
    ? await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "workers"
        WHERE "id" = ${by.workerId} AND "companyId" = ${by.companyId}
        FOR SHARE`
    : await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "workers"
        WHERE "userId" = ${by.userId} AND "companyId" = ${by.companyId}
        FOR SHARE`;
  const id = locked[0]?.id;
  if (!id) return null;
  // Read after the lock: the row cannot change until this transaction ends.
  return tx.worker.findUniqueOrThrow({ where: { id }, select: BOOKING_WORKER_SELECT });
}

/** Throws WorkerInactiveError unless the (locked) worker is active. */
export function assertWorkerActive(worker: BookingWorker, message?: string): void {
  if (!isWorkerActive(worker)) throw new WorkerInactiveError(message);
}

/**
 * The checks before a supervisor, manager or admin records work for a worker
 * on a site, in this order: the worker exists in the company (404), is
 * assigned to the site (403) and is active (422 WORKER_INACTIVE). The status
 * is checked last, so it is only reported for a worker on a site the caller
 * can reach. Leaves the worker row locked until the transaction ends and
 * returns it.
 */
export async function lockBookableWorkerOnSite(
  tx: Prisma.TransactionClient,
  where: { workerId: string; siteId: string; projectId: string; companyId: string },
): Promise<BookingWorker> {
  const worker = await lockWorkerForBooking(tx, { workerId: where.workerId, companyId: where.companyId });
  if (!worker) throw new NotFoundError('Worker');

  const assignment = await tx.workerAssignment.findFirst({
    where: { workerId: where.workerId, siteId: where.siteId, projectId: where.projectId, removedAt: null },
    select: { id: true },
  });
  if (!assignment) throw new ForbiddenError('Worker is not assigned to this site');
  assertWorkerActive(worker);
  return worker;
}
