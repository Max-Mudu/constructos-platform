import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { RequestUser } from '../types';
import { Prisma, WorkerEmploymentStatus } from '@prisma/client';
import { getAccessibleProjectIds } from '../middleware/requireProjectAccess';
import { canViewFinancialData } from './report.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateWorkerInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  idNumber?: string;
  trade?: string;
  dailyWage?: number;
  currency?: string;
  employmentStatus?: WorkerEmploymentStatus;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  notes?: string;
}

export interface UpdateWorkerInput {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  idNumber?: string | null;
  trade?: string | null;
  dailyWage?: number | null;
  currency?: string;
  employmentStatus?: WorkerEmploymentStatus;
  isActive?: boolean;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  notes?: string | null;
}

export interface ListWorkersFilters {
  search?: string;
  trade?: string;
  isActive?: boolean;
  siteId?: string;
  projectId?: string;
}

// ─── Select ───────────────────────────────────────────────────────────────────

const WORKER_SELECT = {
  id: true,
  companyId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  idNumber: true,
  trade: true,
  dailyWage: true,
  currency: true,
  employmentStatus: true,
  isActive: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  notes: true,
  photoUrl: true,
  createdAt: true,
  updatedAt: true,
} as const;

// ─── Financial field visibility ───────────────────────────────────────────────
//
// dailyWage and currency are FINANCIAL (an individual pay rate). They are
// returned only to callers passing canViewFinancialData(actor):
//   - super_admin / company_admin / finance_officer: every worker in the company;
//   - project_manager with canViewFinance: only workers with an active
//     assignment on a project the PM is an active member of (a worker is a
//     company-level record, so "member projects only" is decided per worker).
// Everyone else gets the record with those two keys OMITTED (never 0/null).
// Audit-log snapshots keep the full record. Who may read or write a worker is
// unchanged.

type WorkerFinancialKey = 'dailyWage' | 'currency';

/** Strips the financial keys from a worker record (any select that includes them). */
function withoutWage<T extends Record<WorkerFinancialKey, unknown>>(
  worker: T,
): Omit<T, WorkerFinancialKey> {
  const { dailyWage: _dailyWage, currency: _currency, ...rest } = worker;
  return rest;
}

/**
 * Returns the subset of workerIds whose wage the actor may see.
 * Never inferred from membership alone: the finance gate is checked first.
 */
async function wageVisibleWorkerIds(
  actor: RequestUser,
  workerIds: string[],
): Promise<Set<string>> {
  if (workerIds.length === 0 || !canViewFinancialData(actor)) return new Set();

  const projectIds = await getAccessibleProjectIds(actor.companyId, actor.id, actor.role);
  if (projectIds === null) return new Set(workerIds); // company-wide finance roles

  if (projectIds.length === 0) return new Set();
  const assignments = await prisma.workerAssignment.findMany({
    where: {
      companyId: actor.companyId,
      workerId:  { in: workerIds },
      projectId: { in: projectIds },
      removedAt: null,
    },
    select: { workerId: true },
  });
  return new Set(assignments.map((a) => a.workerId));
}

type WorkerRecord = Prisma.WorkerGetPayload<{ select: typeof WORKER_SELECT }>;

/** A worker as returned to the caller; dailyWage/currency absent without finance access. */
export type WorkerView<T extends WorkerRecord = WorkerRecord> =
  Omit<T, WorkerFinancialKey> & Partial<Pick<T, WorkerFinancialKey>>;

async function presentWorkers<T extends WorkerRecord>(
  workers: T[],
  actor: RequestUser,
): Promise<WorkerView<T>[]> {
  const visible = await wageVisibleWorkerIds(actor, workers.map((w) => w.id));
  return workers.map((w) => (visible.has(w.id) ? w : withoutWage(w)) as WorkerView<T>);
}

async function presentWorker<T extends WorkerRecord>(
  worker: T,
  actor: RequestUser,
): Promise<WorkerView<T>> {
  const [view] = await presentWorkers([worker], actor);
  return view!;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns all site IDs a supervisor is explicitly assigned to across ALL projects.
 */
async function getSupervisorAllSiteIds(userId: string): Promise<string[]> {
  const memberships = await prisma.projectMember.findMany({
    where: { userId, removedAt: null, siteId: { not: null } },
    select: { siteId: true },
  });
  return memberships.map((m) => m.siteId as string);
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function listWorkers(actor: RequestUser, filters: ListWorkersFilters = {}) {
  // Build scope filter based on role
  let assignmentFilter: object | undefined;

  if (actor.role === 'site_supervisor') {
    const siteIds = await getSupervisorAllSiteIds(actor.id);
    assignmentFilter = {
      assignments: {
        some: { siteId: { in: siteIds }, removedAt: null },
      },
    };
  } else if (actor.role === 'project_manager') {
    const projectIds = await getAccessibleProjectIds(actor.companyId, actor.id, actor.role);
    if (projectIds !== null) {
      assignmentFilter = {
        assignments: {
          some: { projectId: { in: projectIds }, removedAt: null },
        },
      };
    }
  }
  // company_admin, finance_officer: no additional scoping

  // Build search / filter conditions
  const searchFilter = filters.search
    ? {
        OR: [
          { firstName: { contains: filters.search, mode: 'insensitive' as const } },
          { lastName:  { contains: filters.search, mode: 'insensitive' as const } },
          { idNumber:  { contains: filters.search, mode: 'insensitive' as const } },
          { phone:     { contains: filters.search, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const tradeFilter  = filters.trade    ? { trade: filters.trade }        : {};
  const activeFilter = filters.isActive !== undefined ? { isActive: filters.isActive } : {};
  const siteFilter   = filters.siteId
    ? { assignments: { some: { siteId: filters.siteId, removedAt: null } } }
    : {};
  const projectFilter = filters.projectId
    ? { assignments: { some: { projectId: filters.projectId, removedAt: null } } }
    : {};

  const workers = await prisma.worker.findMany({
    where: {
      companyId: actor.companyId,
      ...assignmentFilter,
      ...searchFilter,
      ...tradeFilter,
      ...activeFilter,
      ...siteFilter,
      ...projectFilter,
    },
    select:  WORKER_SELECT,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    take:    500,
  });
  return presentWorkers(workers, actor);
}

export async function getWorker(workerId: string, actor: RequestUser) {
  const worker = await prisma.worker.findFirst({
    where: { id: workerId, companyId: actor.companyId },
    select: {
      ...WORKER_SELECT,
      assignments: {
        where: { removedAt: null },
        select: {
          id: true,
          projectId: true,
          siteId: true,
          assignedAt: true,
          project: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!worker) throw new NotFoundError('Worker');
  return presentWorker(worker, actor);
}

export async function createWorker(input: CreateWorkerInput, actor: RequestUser) {
  const worker = await prisma.worker.create({
    data: {
      companyId:            actor.companyId,
      firstName:            input.firstName,
      lastName:             input.lastName,
      email:                input.email,
      phone:                input.phone,
      idNumber:             input.idNumber,
      trade:                input.trade,
      dailyWage:            input.dailyWage,
      currency:             input.currency ?? 'USD',
      employmentStatus:     input.employmentStatus ?? 'active',
      emergencyContactName: input.emergencyContactName,
      emergencyContactPhone: input.emergencyContactPhone,
      notes:                input.notes,
    },
    select: WORKER_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:   actor.companyId,
      userId:      actor.id,
      userEmail:   actor.email,
      userRole:    actor.role,
      action:      'create',
      entityType:  'worker',
      entityId:    worker.id,
      changesAfter: worker as object,
    },
  });

  return presentWorker(worker, actor);
}

export async function updateWorker(
  workerId: string,
  input: UpdateWorkerInput,
  actor: RequestUser,
) {
  const before = await prisma.worker.findFirst({
    where: { id: workerId, companyId: actor.companyId },
    select: WORKER_SELECT,
  });
  if (!before) throw new NotFoundError('Worker');

  const updated = await prisma.worker.update({
    where: { id: workerId },
    data: {
      ...(input.firstName            !== undefined && { firstName: input.firstName }),
      ...(input.lastName             !== undefined && { lastName: input.lastName }),
      ...(input.email                !== undefined && { email: input.email }),
      ...(input.phone                !== undefined && { phone: input.phone }),
      ...(input.idNumber             !== undefined && { idNumber: input.idNumber }),
      ...(input.trade                !== undefined && { trade: input.trade }),
      ...(input.dailyWage            !== undefined && { dailyWage: input.dailyWage }),
      ...(input.currency             !== undefined && { currency: input.currency }),
      ...(input.employmentStatus     !== undefined && {
        employmentStatus: input.employmentStatus,
        isActive: input.employmentStatus === 'active',
      }),
      ...(input.isActive             !== undefined && { isActive: input.isActive }),
      ...(input.emergencyContactName !== undefined && { emergencyContactName: input.emergencyContactName }),
      ...(input.emergencyContactPhone !== undefined && { emergencyContactPhone: input.emergencyContactPhone }),
      ...(input.notes                !== undefined && { notes: input.notes }),
    },
    select: WORKER_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'update',
      entityType:   'worker',
      entityId:     workerId,
      changesBefore: before as object,
      changesAfter:  updated as object,
    },
  });

  return presentWorker(updated, actor);
}

export async function deactivateWorker(workerId: string, actor: RequestUser) {
  const worker = await prisma.worker.findFirst({
    where: { id: workerId, companyId: actor.companyId },
    select: WORKER_SELECT,
  });
  if (!worker) throw new NotFoundError('Worker');

  const updated = await prisma.worker.update({
    where: { id: workerId },
    data: { isActive: false, employmentStatus: 'inactive' },
    select: WORKER_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'delete',
      entityType:   'worker',
      entityId:     workerId,
      changesBefore: worker as object,
      changesAfter:  updated as object,
    },
  });
}

// ─── Worker assignments ───────────────────────────────────────────────────────

export async function listSiteWorkers(
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  const workers = await prisma.worker.findMany({
    where: {
      companyId: actor.companyId,
      assignments: {
        some: { projectId, siteId, removedAt: null },
      },
    },
    select: WORKER_SELECT,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  return presentWorkers(workers, actor);
}

export async function assignWorkerToSite(
  projectId: string,
  siteId: string,
  workerId: string,
  actor: RequestUser,
) {
  // Verify worker belongs to this company
  const worker = await prisma.worker.findFirst({
    where: { id: workerId, companyId: actor.companyId },
    select: { id: true },
  });
  if (!worker) throw new NotFoundError('Worker');

  // Verify site belongs to this company + project
  const site = await prisma.jobSite.findFirst({
    where: { id: siteId, projectId, companyId: actor.companyId },
    select: { id: true },
  });
  if (!site) throw new NotFoundError('Site');

  // Upsert: restore if previously removed
  const existing = await prisma.workerAssignment.findUnique({
    where: { siteId_workerId: { siteId, workerId } },
  });

  if (existing) {
    if (existing.removedAt === null) {
      throw new ValidationError('Worker is already assigned to this site');
    }
    // Restore
    const assignment = await prisma.workerAssignment.update({
      where: { id: existing.id },
      data: {
        removedAt:   null,
        assignedById: actor.id,
        assignedAt:   new Date(),
        projectId,
      },
    });
    await prisma.auditLog.create({
      data: {
        companyId:   actor.companyId,
        userId:      actor.id,
        userEmail:   actor.email,
        userRole:    actor.role,
        action:      'create',
        entityType:  'worker_assignment',
        entityId:    assignment.id,
        changesAfter: { workerId, siteId, projectId } as object,
      },
    });
    return assignment;
  }

  const assignment = await prisma.workerAssignment.create({
    data: {
      companyId:   actor.companyId,
      projectId,
      siteId,
      workerId,
      assignedById: actor.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      companyId:   actor.companyId,
      userId:      actor.id,
      userEmail:   actor.email,
      userRole:    actor.role,
      action:      'create',
      entityType:  'worker_assignment',
      entityId:    assignment.id,
      changesAfter: { workerId, siteId, projectId } as object,
    },
  });

  return assignment;
}

export async function removeWorkerFromSite(
  projectId: string,
  siteId: string,
  workerId: string,
  actor: RequestUser,
) {
  const assignment = await prisma.workerAssignment.findFirst({
    where: { siteId, workerId, projectId, companyId: actor.companyId, removedAt: null },
  });
  if (!assignment) throw new NotFoundError('Worker assignment');

  await prisma.workerAssignment.update({
    where: { id: assignment.id },
    data: { removedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'delete',
      entityType:   'worker_assignment',
      entityId:     assignment.id,
      changesBefore: { workerId, siteId, projectId } as object,
    },
  });
}
