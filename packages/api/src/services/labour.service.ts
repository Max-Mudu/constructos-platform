import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { RequestUser } from '../types';
import { getAccessibleSiteIds } from '../middleware/requireProjectAccess';
import { emitToCompany } from './event-emitter.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateLabourEntryInput {
  workerId: string;
  date: string;        // "YYYY-MM-DD"
  hoursWorked: number;
  dailyRate: number;
  currency?: string;
  notes?: string;
}

export interface UpdateLabourEntryInput {
  hoursWorked?: number;
  dailyRate?: number;
  currency?: string;
  notes?: string | null;
}

export interface ListLabourFilters {
  date?: string;
  startDate?: string;
  endDate?: string;
  workerId?: string;
}

// ─── Select ───────────────────────────────────────────────────────────────────

const ENTRY_SELECT = {
  id: true,
  companyId: true,
  projectId: true,
  siteId: true,
  workerId: true,
  registeredById: true,
  date: true,
  hoursWorked: true,
  dailyRate: true,
  currency: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  worker: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      trade: true,
    },
  },
  registeredBy: {
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
    throw new NotFoundError('Labour entry');
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

  // Worker must be assigned to the site
  const assignment = await prisma.workerAssignment.findFirst({
    where: { workerId, siteId, projectId, removedAt: null },
  });
  if (!assignment) {
    throw new ForbiddenError('Worker is not assigned to this site');
  }
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function listLabourEntries(
  projectId: string,
  siteId: string,
  actor: RequestUser,
  filters: ListLabourFilters = {},
) {
  await checkSiteAccess(siteId, projectId, actor);

  const dateFilter: object = {};
  if (filters.date) {
    const d = new Date(filters.date);
    const next = new Date(d); next.setDate(next.getDate() + 1);
    Object.assign(dateFilter, { date: { gte: d, lt: next } });
  } else if (filters.startDate || filters.endDate) {
    const range: { gte?: Date; lte?: Date } = {};
    if (filters.startDate) range.gte = new Date(filters.startDate);
    if (filters.endDate)   range.lte = new Date(filters.endDate);
    Object.assign(dateFilter, { date: range });
  }

  return prisma.labourEntry.findMany({
    where: {
      projectId,
      siteId,
      companyId: actor.companyId,
      ...(filters.workerId && { workerId: filters.workerId }),
      ...dateFilter,
    },
    select: ENTRY_SELECT,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getLabourEntry(
  entryId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const entry = await prisma.labourEntry.findFirst({
    where: { id: entryId, projectId, siteId, companyId: actor.companyId },
    select: ENTRY_SELECT,
  });
  if (!entry) throw new NotFoundError('Labour entry');
  return entry;
}

export async function createLabourEntry(
  projectId: string,
  siteId: string,
  input: CreateLabourEntryInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);
  await validateWorkerOnSite(input.workerId, siteId, projectId, actor.companyId);

  const entry = await prisma.labourEntry.create({
    data: {
      companyId:      actor.companyId,
      projectId,
      siteId,
      workerId:       input.workerId,
      registeredById: actor.id,
      date:           new Date(input.date),
      hoursWorked:    input.hoursWorked,
      dailyRate:      input.dailyRate,
      currency:       input.currency ?? 'USD',
      notes:          input.notes,
    },
    select: ENTRY_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:   actor.companyId,
      userId:      actor.id,
      userEmail:   actor.email,
      userRole:    actor.role,
      action:      'create',
      entityType:  'labour_entry',
      entityId:    entry.id,
      changesAfter: entry as object,
    },
  });

  emitToCompany(actor.companyId, {
    type: 'labour_created',
    payload: { entryId: entry.id, projectId, siteId, workerId: entry.workerId },
  });

  return entry;
}

export async function updateLabourEntry(
  entryId: string,
  projectId: string,
  siteId: string,
  input: UpdateLabourEntryInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const before = await prisma.labourEntry.findFirst({
    where: { id: entryId, projectId, siteId, companyId: actor.companyId },
    select: ENTRY_SELECT,
  });
  if (!before) throw new NotFoundError('Labour entry');

  const updated = await prisma.labourEntry.update({
    where: { id: entryId },
    data: {
      ...(input.hoursWorked !== undefined && { hoursWorked: input.hoursWorked }),
      ...(input.dailyRate   !== undefined && { dailyRate:   input.dailyRate }),
      ...(input.currency    !== undefined && { currency:    input.currency }),
      ...(input.notes       !== undefined && { notes:       input.notes }),
    },
    select: ENTRY_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'update',
      entityType:   'labour_entry',
      entityId:     entryId,
      changesBefore: before as object,
      changesAfter:  updated as object,
    },
  });

  return updated;
}

export async function deleteLabourEntry(
  entryId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const entry = await prisma.labourEntry.findFirst({
    where: { id: entryId, projectId, siteId, companyId: actor.companyId },
    select: ENTRY_SELECT,
  });
  if (!entry) throw new NotFoundError('Labour entry');

  await prisma.labourEntry.delete({ where: { id: entryId } });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'delete',
      entityType:   'labour_entry',
      entityId:     entryId,
      changesBefore: entry as object,
    },
  });
}
