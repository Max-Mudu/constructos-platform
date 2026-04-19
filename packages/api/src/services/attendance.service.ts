import { AttendanceStatus } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { RequestUser } from '../types';
import { getAccessibleSiteIds } from '../middleware/requireProjectAccess';

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

async function validateWorkerOnSite(
  workerId: string,
  siteId: string,
  projectId: string,
  companyId: string,
): Promise<void> {
  const worker = await prisma.worker.findFirst({
    where: { id: workerId, companyId },
    select: { id: true },
  });
  if (!worker) throw new NotFoundError('Worker');

  const assignment = await prisma.workerAssignment.findFirst({
    where: { workerId, siteId, projectId, removedAt: null },
  });
  if (!assignment) {
    throw new ForbiddenError('Worker is not assigned to this site');
  }
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
  await validateWorkerOnSite(input.workerId, siteId, projectId, actor.companyId);

  // Check for duplicate (one attendance per worker per site per day)
  const existing = await prisma.attendanceRecord.findFirst({
    where: {
      siteId,
      workerId: input.workerId,
      date: new Date(input.date),
    },
  });
  if (existing) {
    throw new ForbiddenError('Attendance record already exists for this worker on this date');
  }

  const record = await prisma.attendanceRecord.create({
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

  await prisma.auditLog.create({
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
}

export async function updateAttendanceRecord(
  recordId: string,
  projectId: string,
  siteId: string,
  input: UpdateAttendanceInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const before = await prisma.attendanceRecord.findFirst({
    where: { id: recordId, projectId, siteId, companyId: actor.companyId },
    select: RECORD_SELECT,
  });
  if (!before) throw new NotFoundError('Attendance record');

  const updated = await prisma.attendanceRecord.update({
    where: { id: recordId },
    data: {
      ...(input.status       !== undefined && { status:       input.status }),
      ...(input.checkInTime  !== undefined && { checkInTime:  input.checkInTime }),
      ...(input.checkOutTime !== undefined && { checkOutTime: input.checkOutTime }),
      ...(input.notes        !== undefined && { notes:        input.notes }),
    },
    select: RECORD_SELECT,
  });

  await prisma.auditLog.create({
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

  await prisma.attendanceRecord.delete({ where: { id: recordId } });

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
 * - Validates WorkerAssignment for this site
 * - Upserts today's AttendanceRecord (idempotent check-in)
 */
export async function selfAttendance(
  projectId: string,
  siteId: string,
  input: { checkInTime?: string; notes?: string },
  actor: RequestUser,
) {
  // Find the worker record linked to this user account
  const worker = await prisma.worker.findFirst({
    where: { userId: actor.id, companyId: actor.companyId },
    select: { id: true },
  });
  if (!worker) {
    throw new ForbiddenError('No worker profile linked to this account');
  }

  // Validate assignment
  const assignment = await prisma.workerAssignment.findFirst({
    where: { workerId: worker.id, siteId, projectId, removedAt: null },
  });
  if (!assignment) {
    throw new ForbiddenError('Worker is not assigned to this site');
  }

  // Date: today (server date)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Upsert — idempotent: worker can re-submit if they need to update check-in time
  const existing = await prisma.attendanceRecord.findFirst({
    where: { siteId, workerId: worker.id, date: { gte: today, lt: tomorrow } },
    select: RECORD_SELECT,
  });

  if (existing) {
    // Update check-in time / notes if provided
    const updated = await prisma.attendanceRecord.update({
      where: { id: existing.id },
      data: {
        ...(input.checkInTime !== undefined && { checkInTime: input.checkInTime }),
        ...(input.notes       !== undefined && { notes:       input.notes }),
      },
      select: RECORD_SELECT,
    });

    await prisma.auditLog.create({
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

  const record = await prisma.attendanceRecord.create({
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

  await prisma.auditLog.create({
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
