import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { RequestUser } from '../types';
import { getAccessibleSiteIds } from '../middleware/requireProjectAccess';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateTargetInput {
  date:         string;   // "YYYY-MM-DD"
  description:  string;
  targetValue:  number;
  targetUnit:   string;
  actualValue?: number;
  workerId?:    string;
  notes?:       string;
}

export interface UpdateTargetInput {
  description?: string;
  targetValue?: number;
  targetUnit?:  string;
  actualValue?: number | null;
  workerId?:    string | null;
  notes?:       string | null;
}

export interface ListTargetFilters {
  date?:      string;
  startDate?: string;
  endDate?:   string;
  workerId?:  string;
}

// ─── Select ───────────────────────────────────────────────────────────────────

const TARGET_SELECT = {
  id:           true,
  companyId:    true,
  projectId:    true,
  siteId:       true,
  workerId:     true,
  date:         true,
  description:  true,
  targetValue:  true,
  targetUnit:   true,
  actualValue:  true,
  notes:        true,
  setById:      true,
  approvedById: true,
  approvedAt:   true,
  createdAt:    true,
  updatedAt:    true,
  setBy: {
    select: { id: true, firstName: true, lastName: true },
  },
  approvedBy: {
    select: { id: true, firstName: true, lastName: true },
  },
  worker: {
    select: { id: true, firstName: true, lastName: true, trade: true },
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
    throw new NotFoundError('Daily target');
  }
}

function addCompletionPct<T extends { targetValue: unknown; actualValue: unknown }>(target: T) {
  const tv = parseFloat(String(target.targetValue));
  const av = target.actualValue != null ? parseFloat(String(target.actualValue)) : null;
  const completionPct = av != null && tv > 0 ? Math.round((av / tv) * 100) : null;
  return { ...target, completionPct };
}

function buildDateFilter(filters: ListTargetFilters): object {
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

export async function listTargets(
  projectId: string,
  siteId: string,
  actor: RequestUser,
  filters: ListTargetFilters = {},
) {
  await checkSiteAccess(siteId, projectId, actor);

  const targets = await prisma.dailyTarget.findMany({
    where: {
      projectId,
      siteId,
      companyId: actor.companyId,
      ...(filters.workerId && { workerId: filters.workerId }),
      ...buildDateFilter(filters),
    },
    select: TARGET_SELECT,
    orderBy: [{ date: 'desc' }, { createdAt: 'asc' }],
  });

  return targets.map(addCompletionPct);
}

export async function getTarget(
  targetId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const target = await prisma.dailyTarget.findFirst({
    where: { id: targetId, projectId, siteId, companyId: actor.companyId },
    select: TARGET_SELECT,
  });
  if (!target) throw new NotFoundError('Daily target');
  return addCompletionPct(target);
}

export async function createTarget(
  projectId: string,
  siteId: string,
  input: CreateTargetInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  // If workerId provided, verify worker belongs to company (not necessarily on site for targets)
  if (input.workerId) {
    const worker = await prisma.worker.findFirst({
      where: { id: input.workerId, companyId: actor.companyId },
      select: { id: true },
    });
    if (!worker) throw new NotFoundError('Worker');
  }

  const target = await prisma.dailyTarget.create({
    data: {
      companyId:   actor.companyId,
      projectId,
      siteId,
      workerId:    input.workerId    ?? null,
      setById:     actor.id,
      date:        new Date(input.date),
      description: input.description,
      targetValue: input.targetValue,
      targetUnit:  input.targetUnit,
      actualValue: input.actualValue ?? null,
      notes:       input.notes       ?? null,
    },
    select: TARGET_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'create',
      entityType:   'daily_target',
      entityId:     target.id,
      changesAfter: target as object,
    },
  });

  return addCompletionPct(target);
}

export async function updateTarget(
  targetId: string,
  projectId: string,
  siteId: string,
  input: UpdateTargetInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const before = await prisma.dailyTarget.findFirst({
    where: { id: targetId, projectId, siteId, companyId: actor.companyId },
    select: TARGET_SELECT,
  });
  if (!before) throw new NotFoundError('Daily target');

  // If approvedById is already set, only allow admin/PM to update key fields
  if (before.approvedById && actor.role === 'site_supervisor') {
    // Supervisors can still update actualValue after approval
    const allowedFields = ['actualValue', 'notes'] as (keyof UpdateTargetInput)[];
    const attempted = Object.keys(input) as (keyof UpdateTargetInput)[];
    const disallowed = attempted.filter(k => !allowedFields.includes(k));
    if (disallowed.length > 0) {
      throw new ForbiddenError('Cannot modify approved target fields');
    }
  }

  const updated = await prisma.dailyTarget.update({
    where: { id: targetId },
    data: {
      ...(input.description !== undefined && { description: input.description }),
      ...(input.targetValue !== undefined && { targetValue: input.targetValue }),
      ...(input.targetUnit  !== undefined && { targetUnit:  input.targetUnit }),
      ...(input.actualValue !== undefined && { actualValue: input.actualValue }),
      ...(input.workerId    !== undefined && { workerId:    input.workerId }),
      ...(input.notes       !== undefined && { notes:       input.notes }),
    },
    select: TARGET_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'update',
      entityType:    'daily_target',
      entityId:      targetId,
      changesBefore: before   as object,
      changesAfter:  updated  as object,
    },
  });

  return addCompletionPct(updated);
}

export async function approveTarget(
  targetId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const target = await prisma.dailyTarget.findFirst({
    where: { id: targetId, projectId, siteId, companyId: actor.companyId },
    select: TARGET_SELECT,
  });
  if (!target) throw new NotFoundError('Daily target');

  if (target.approvedById) {
    throw new ForbiddenError('Target is already approved');
  }

  const approved = await prisma.dailyTarget.update({
    where: { id: targetId },
    data: {
      approvedById: actor.id,
      approvedAt:   new Date(),
    },
    select: TARGET_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'update',
      entityType:    'daily_target',
      entityId:      targetId,
      changesBefore: target   as object,
      changesAfter:  approved as object,
    },
  });

  return addCompletionPct(approved);
}

export async function deleteTarget(
  targetId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const target = await prisma.dailyTarget.findFirst({
    where: { id: targetId, projectId, siteId, companyId: actor.companyId },
    select: TARGET_SELECT,
  });
  if (!target) throw new NotFoundError('Daily target');

  await prisma.dailyTarget.delete({ where: { id: targetId } });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'delete',
      entityType:    'daily_target',
      entityId:      targetId,
      changesBefore: target as object,
    },
  });
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export async function getTargetSummary(
  projectId: string,
  siteId: string,
  actor: RequestUser,
  date: string,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const d    = new Date(date);
  const next = new Date(d);
  next.setDate(next.getDate() + 1);

  const targets = await prisma.dailyTarget.findMany({
    where: {
      projectId,
      siteId,
      companyId: actor.companyId,
      date: { gte: d, lt: next },
    },
    select: { targetValue: true, actualValue: true, approvedById: true },
  });

  const total    = targets.length;
  const approved = targets.filter(t => t.approvedById != null).length;
  const withActual = targets.filter(t => t.actualValue != null).length;
  const avgCompletion = total > 0
    ? Math.round(
        targets.reduce((sum, t) => {
          const tv = parseFloat(String(t.targetValue));
          const av = t.actualValue != null ? parseFloat(String(t.actualValue)) : 0;
          return sum + (tv > 0 ? (av / tv) * 100 : 0);
        }, 0) / total,
      )
    : 0;

  return { total, approved, withActual, avgCompletion };
}
