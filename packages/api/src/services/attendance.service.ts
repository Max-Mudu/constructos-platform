import { AttendanceStatus, Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { RequestUser } from '../types';
import { getAccessibleSiteIds } from '../middleware/requireProjectAccess';
import { assertPayPeriodOpen, withPayPeriodOpen } from './pay-period-lock.service';
import { assertWorkerActive, lockBookableWorkerOnSite, lockWorkerForBooking } from './worker-booking';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateAttendanceInput {
  workerId:     string;
  date:         string;   // "YYYY-MM-DD"
  status:       AttendanceStatus;
  checkInTime?: string;   // "HH:MM"
  checkOutTime?: string;  // "HH:MM"
  notes?:       string;
}

export interface UpdateAttendanceInput {
  status?:       AttendanceStatus;
  checkInTime?:  string | null;
  checkOutTime?: string | null;
  notes?:        string | null;
}

export interface ListAttendanceFilters {
  date?:      string;
  startDate?: string;
  endDate?:   string;
  workerId?:  string;
  status?:    AttendanceStatus;
}

// ─── Select ───────────────────────────────────────────────────────────────────

const RECORD_SELECT = {
  id:           true,
  companyId:    true,
  projectId:    true,
  siteId:       true,
  workerId:     true,
  date:         true,
  status:       true,
  checkInTime:  true,
  checkOutTime: true,
  notes:        true,
  recordedById: true,
  createdAt:    true,
  updatedAt:    true,
  worker: {
    select: { id: true, firstName: true, lastName: true, trade: true },
  },
  recordedBy: {
    select: { id: true, firstName: true, lastName: true },
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function checkSiteAccess(
  siteId: string,
  projectId: string,
  actor: RequestUser,
): Promise<void> {
  const accessibleSiteIds = await getAccessibleSiteIds(projectId, actor.id, actor.role);
  if (accessibleSiteIds !== null && !accessibleSiteIds.includes(siteId)) {
    throw new NotFoundError('Attendance record');
  }
}

/**
 * Check-in and check-out are "HH:MM" times on the record's date (the product
 * has no overnight shifts), so a check-out earlier than the check-in is
 * rejected. Equal times are allowed. Zero-padded HH:MM strings sort in time
 * order, so a string comparison is exact.
 */
function assertTimeOrder(checkInTime: string | null, checkOutTime: string | null): void {
  if (checkInTime && checkOutTime && checkOutTime < checkInTime) {
    throw new ValidationError(
      `Check-out time (${checkOutTime}) cannot be earlier than check-in time (${checkInTime})`,
    );
  }
}

/**
 * Locks one attendance record row until the surrounding transaction ends, so
 * a change that is checked against the stored times cannot interleave with
 * another change of the same record. Returns false when no row matches.
 */
async function lockAttendanceRecord(
  tx: Prisma.TransactionClient,
  where: { id: string; projectId: string; siteId: string; companyId: string },
): Promise<boolean> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "attendance_records"
    WHERE "id" = ${where.id} AND "projectId" = ${where.projectId}
      AND "siteId" = ${where.siteId} AND "companyId" = ${where.companyId}
    FOR UPDATE`;
  return locked.length === 1;
}

function buildDateFilter(filters: ListAttendanceFilters): object {
  if (filters.date) {
    const d    = new Date(filters.date);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    return { date: { gte: d, lt: next } };
  }
  if (filters.startDate || filters.endDate) {
    const range: { gte?: Date; lte?: Date } = {};
    if (filters.startDate) range.gte = new Date(filters.startDate);
    if (filters.endDate)   range.lte = new Date(filters.endDate);
    return { date: range };
  }
  return {};
}

// ─── Service Functions ────────────────────────────────────────────────────────

export async function listAttendanceRecords(
  projectId: string,
  siteId: string,
  actor: RequestUser,
  filters: ListAttendanceFilters = {},
) {
  await checkSiteAccess(siteId, projectId, actor);

  return prisma.attendanceRecord.findMany({
    where: {
      projectId,
      siteId,
      companyId: actor.companyId,
      ...(filters.workerId && { workerId: filters.workerId }),
      ...(filters.status   && { status:   filters.status }),
      ...buildDateFilter(filters),
    },
    select: RECORD_SELECT,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getAttendanceRecord(
  recordId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const record = await prisma.attendanceRecord.findFirst({
    where: { id: recordId, projectId, siteId, companyId: actor.companyId },
    select: RECORD_SELECT,
  });
  if (!record) throw new NotFoundError('Attendance record');
  return record;
}

export async function createAttendanceRecord(
  projectId: string,
  siteId: string,
  input: CreateAttendanceInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);
  assertTimeOrder(input.checkInTime ?? null, input.checkOutTime ?? null);

  // The worker's status is checked with the worker row locked, in the same
  // transaction as the new record and its audit row (see worker-booking.ts).
  return prisma.$transaction(async (tx) => {
    // Refused when the record's date is in a closed pay period.
    await assertPayPeriodOpen(tx, actor.companyId, [new Date(input.date)]);
    await lockBookableWorkerOnSite(tx, {
      workerId: input.workerId, siteId, projectId, companyId: actor.companyId,
    });

    // Check for duplicate (one attendance per worker per site per day)
    const existing = await tx.attendanceRecord.findFirst({
      where: {
        siteId,
        workerId: input.workerId,
        date: new Date(input.date),
      },
    });
    if (existing) {
      throw new ForbiddenError('Attendance record already exists for this worker on this date');
    }

    const record = await tx.attendanceRecord.create({
      data: {
        companyId:    actor.companyId,
        projectId,
        siteId,
        workerId:     input.workerId,
        recordedById: actor.id,
        date:         new Date(input.date),
        status:       input.status,
        checkInTime:  input.checkInTime  ?? null,
        checkOutTime: input.checkOutTime ?? null,
        notes:        input.notes        ?? null,
      },
      select: RECORD_SELECT,
    });

    await tx.auditLog.create({
      data: {
        companyId:    actor.companyId,
        userId:       actor.id,
        userEmail:    actor.email,
        userRole:     actor.role,
        action:       'create',
        entityType:   'attendance_record',
        entityId:     record.id,
        changesAfter: record as object,
      },
    });

    return record;
  });
}

export async function updateAttendanceRecord(
  recordId: string,
  projectId: string,
  siteId: string,
  input: UpdateAttendanceInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  // The record row is locked before the times are checked, so a time sent
  // alone is checked against the other time as it is stored when this change
  // commits, not as it was when the request started. The update and its audit
  // row commit together.
  return prisma.$transaction(async (tx) => {
    const found = await lockAttendanceRecord(tx, {
      id: recordId, projectId, siteId, companyId: actor.companyId,
    });
    if (!found) throw new NotFoundError('Attendance record');

    const before = await tx.attendanceRecord.findUniqueOrThrow({
      where: { id: recordId },
      select: RECORD_SELECT,
    });

    // A record in a closed pay period cannot be edited.
    await assertPayPeriodOpen(tx, actor.companyId, [before.date]);

    // Only a request that changes a time is checked, so a status or notes
    // correction still works on an older record whose stored times are out
    // of order.
    if (input.checkInTime !== undefined || input.checkOutTime !== undefined) {
      assertTimeOrder(
        input.checkInTime  !== undefined ? input.checkInTime  : before.checkInTime,
        input.checkOutTime !== undefined ? input.checkOutTime : before.checkOutTime,
      );
    }

    const updated = await tx.attendanceRecord.update({
      where: { id: recordId },
      data: {
        ...(input.status       !== undefined && { status:       input.status }),
        ...(input.checkInTime  !== undefined && { checkInTime:  input.checkInTime }),
        ...(input.checkOutTime !== undefined && { checkOutTime: input.checkOutTime }),
        ...(input.notes        !== undefined && { notes:        input.notes }),
      },
      select: RECORD_SELECT,
    });

    await tx.auditLog.create({
      data: {
        companyId:     actor.companyId,
        userId:        actor.id,
        userEmail:     actor.email,
        userRole:      actor.role,
        action:        'update',
        entityType:    'attendance_record',
        entityId:      recordId,
        changesBefore: before  as object,
        changesAfter:  updated as object,
      },
    });

    return updated;
  });
}

export async function deleteAttendanceRecord(
  recordId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const record = await prisma.attendanceRecord.findFirst({
    where: { id: recordId, projectId, siteId, companyId: actor.companyId },
    select: RECORD_SELECT,
  });
  if (!record) throw new NotFoundError('Attendance record');

  // A record in a closed pay period cannot be deleted.
  await withPayPeriodOpen(actor.companyId, [record.date], (tx) => tx.attendanceRecord.delete({ where: { id: recordId } }));

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'delete',
      entityType:    'attendance_record',
      entityId:      recordId,
      changesBefore: record as object,
    },
  });
}

// ─── Worker self-service attendance ──────────────────────────────────────────

/**
 * A worker submits their own attendance for today.
 * - Actor must have role 'worker'
 * - Derives the Worker record via actor.id → worker.userId
 * - The worker must be active (422 WORKER_INACTIVE otherwise, also for a
 *   re-submission of today's record)
 * - Validates WorkerAssignment for this site
 * - Upserts today's AttendanceRecord (idempotent check-in)
 */
export async function selfAttendance(
  projectId: string,
  siteId: string,
  input: { checkInTime?: string; notes?: string },
  actor: RequestUser,
) {
  // Date: today (server date)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // The worker row is locked while its status is checked and today's record
  // is written; the write and its audit row commit together.
  return prisma.$transaction(async (tx) => {
    // Checked against the calendar date the record is stored under (the
    // UTC date of the server's midnight), like every other attendance write.
    await assertPayPeriodOpen(tx, actor.companyId, [new Date(today.toISOString().slice(0, 10))]);

    // Find the worker record linked to this user account
    const worker = await lockWorkerForBooking(tx, { userId: actor.id, companyId: actor.companyId });
    if (!worker) {
      throw new ForbiddenError('No worker profile linked to this account');
    }
    assertWorkerActive(worker, 'Your worker profile is inactive, so attendance cannot be recorded');

    // Validate assignment
    const assignment = await tx.workerAssignment.findFirst({
      where: { workerId: worker.id, siteId, projectId, removedAt: null },
    });
    if (!assignment) {
      throw new ForbiddenError('Worker is not assigned to this site');
    }

    // Upsert — idempotent: worker can re-submit if they need to update check-in time
    const existing = await tx.attendanceRecord.findFirst({
      where: { siteId, workerId: worker.id, date: { gte: today, lt: tomorrow } },
      select: { id: true, projectId: true, siteId: true, companyId: true },
    });

    if (existing) {
      // Update check-in time / notes if provided. A check-out may have been
      // recorded by a supervisor since; the new check-in is checked against it
      // under the row lock.
      const found = await lockAttendanceRecord(tx, existing);
      if (!found) throw new NotFoundError('Attendance record');

      if (input.checkInTime !== undefined) {
        const current = await tx.attendanceRecord.findUniqueOrThrow({
          where:  { id: existing.id },
          select: { checkOutTime: true },
        });
        assertTimeOrder(input.checkInTime, current.checkOutTime);
      }

      const updated = await tx.attendanceRecord.update({
        where: { id: existing.id },
        data: {
          ...(input.checkInTime !== undefined && { checkInTime: input.checkInTime }),
          ...(input.notes       !== undefined && { notes:       input.notes }),
        },
        select: RECORD_SELECT,
      });

      await tx.auditLog.create({
        data: {
          companyId:    actor.companyId,
          userId:       actor.id,
          userEmail:    actor.email,
          userRole:     actor.role,
          action:       'update',
          entityType:   'attendance_record',
          entityId:     existing.id,
          changesAfter: updated as object,
        },
      });

      return updated;
    }

    const record = await tx.attendanceRecord.create({
      data: {
        companyId:    actor.companyId,
        projectId,
        siteId,
        workerId:     worker.id,
        recordedById: actor.id,
        date:         today,
        status:       'present',
        checkInTime:  input.checkInTime ?? null,
        notes:        input.notes       ?? null,
      },
      select: RECORD_SELECT,
    });

    await tx.auditLog.create({
      data: {
        companyId:    actor.companyId,
        userId:       actor.id,
        userEmail:    actor.email,
        userRole:     actor.role,
        action:       'create',
        entityType:   'attendance_record',
        entityId:     record.id,
        changesAfter: record as object,
      },
    });

    return record;
  });
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export async function getAttendanceSummary(
  projectId: string,
  siteId: string,
  actor: RequestUser,
  date: string,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const d    = new Date(date);
  const next = new Date(d);
  next.setDate(next.getDate() + 1);

  const records = await prisma.attendanceRecord.findMany({
    where: {
      projectId,
      siteId,
      companyId: actor.companyId,
      date: { gte: d, lt: next },
    },
    select: { status: true },
  });

  const summary = {
    total:    records.length,
    present:  0,
    absent:   0,
    late:     0,
    half_day: 0,
    excused:  0,
  };

  for (const r of records) {
    summary[r.status] = (summary[r.status] ?? 0) + 1;
  }

  return summary;
}
