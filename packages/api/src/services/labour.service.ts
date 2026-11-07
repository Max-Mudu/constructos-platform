import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { AppError, NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { RequestUser } from '../types';
import { getAccessibleSiteIds } from '../middleware/requireProjectAccess';
import { emitToCompany } from './event-emitter.service';
import { canViewFinancialData } from './report.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateLabourEntryInput {
  workerId: string;
  date: string;        // "YYYY-MM-DD"
  hoursWorked: number;
  /** Honoured only for finance-authorised callers; otherwise derived from the worker. */
  dailyRate?: number;
  /** Honoured only for finance-authorised callers supplying dailyRate. */
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

// ─── Financial field visibility ───────────────────────────────────────────────
//
// dailyRate and currency are FINANCIAL (an individual pay rate). They are
// returned only when canViewFinancialData(actor) — company_admin /
// finance_officer / super_admin, or project_manager with canViewFinance. Every
// labour route runs requireProjectAccess, so a project_manager reaching these
// functions is already a member of the project ("member projects only").
// For everyone else the two keys are OMITTED from the response (never 0/null);
// all other fields (worker, date, hours, notes, …) are unchanged.
// Audit-log snapshots keep the full record.

type LabourFinancialKey = 'dailyRate' | 'currency';
type LabourEntryRecord = Prisma.LabourEntryGetPayload<{ select: typeof ENTRY_SELECT }>;

/** A labour entry as returned to the caller; financial keys absent without finance access. */
export type LabourEntryView =
  Omit<LabourEntryRecord, LabourFinancialKey> & Partial<Pick<LabourEntryRecord, LabourFinancialKey>>;

function presentEntry(entry: LabourEntryRecord, actor: RequestUser): LabourEntryView {
  if (canViewFinancialData(actor)) return entry;
  const { dailyRate: _dailyRate, currency: _currency, ...rest } = entry;
  return rest;
}

// ─── Who may CHOOSE a rate (write policy) ─────────────────────────────────────
//
// A pay rate is only ever written from a trusted source:
//   - Callers passing canViewFinancialData(actor) may supply dailyRate (and
//     currency) explicitly. Every labour route runs requireProjectAccess, so a
//     project_manager reaching here is an active member of the project.
//   - Everyone else (site_supervisor, project_manager without canViewFinance)
//     may record operational entries but a dailyRate / currency they submit is
//     IGNORED — on create the rate is derived from Worker.dailyWage / currency,
//     on update the stored rate and currency are left untouched.
//   - When no explicit rate is honoured and the worker has no daily wage on
//     record the create is rejected (422 WORKER_WAGE_MISSING) — never stored as 0.

export class WorkerWageMissingError extends AppError {
  constructor() {
    super(
      422,
      'This worker has no daily wage on record; ask a finance user to set it',
      'WORKER_WAGE_MISSING',
    );
  }
}

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
): Promise<{ dailyWage: Prisma.Decimal | null; currency: string }> {
  const worker = await prisma.worker.findFirst({
    where: { id: workerId, companyId },
    select: { id: true, dailyWage: true, currency: true },
  });
  if (!worker) throw new NotFoundError('Worker');

  // Worker must be assigned to the site
  const assignment = await prisma.workerAssignment.findFirst({
    where: { workerId, siteId, projectId, removedAt: null },
  });
  if (!assignment) {
    throw new ForbiddenError('Worker is not assigned to this site');
  }
  return { dailyWage: worker.dailyWage, currency: worker.currency };
}

/**
 * Resolves the rate/currency to store on a new entry (see write policy above).
 * An explicit rate is honoured only for finance-authorised callers; it is
 * paired with the submitted currency, else the worker's currency. Otherwise the
 * worker's wage AND currency are used together, whatever was submitted.
 */
function resolveCreateRate(
  input: CreateLabourEntryInput,
  worker: { dailyWage: Prisma.Decimal | null; currency: string },
  actor: RequestUser,
): { dailyRate: Prisma.Decimal | number; currency: string } {
  if (canViewFinancialData(actor) && input.dailyRate !== undefined) {
    return { dailyRate: input.dailyRate, currency: input.currency ?? worker.currency };
  }
  if (worker.dailyWage === null || !worker.dailyWage.greaterThan(0)) {
    throw new WorkerWageMissingError();
  }
  return { dailyRate: worker.dailyWage, currency: worker.currency };
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

  const entries = await prisma.labourEntry.findMany({
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
  return entries.map((e) => presentEntry(e, actor));
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
  return presentEntry(entry, actor);
}

export async function createLabourEntry(
  projectId: string,
  siteId: string,
  input: CreateLabourEntryInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);
  const worker = await validateWorkerOnSite(input.workerId, siteId, projectId, actor.companyId);
  const { dailyRate, currency } = resolveCreateRate(input, worker, actor);

  const entry = await prisma.labourEntry.create({
    data: {
      companyId:      actor.companyId,
      projectId,
      siteId,
      workerId:       input.workerId,
      registeredById: actor.id,
      date:           new Date(input.date),
      hoursWorked:    input.hoursWorked,
      dailyRate,
      currency,
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

  return presentEntry(entry, actor);
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

  // Write policy: rate/currency changes are honoured only for finance-authorised
  // callers; for anyone else they are ignored and the stored values kept.
  const mayWriteRate = canViewFinancialData(actor);

  // An entry keeps the currency it was recorded in: there is no conversion, so
  // changing it would silently re-denominate the rate. Resending the same
  // currency is accepted; non-finance callers' currency is ignored as before.
  if (mayWriteRate && input.currency !== undefined && input.currency !== before.currency) {
    throw new ValidationError('The currency of an existing labour entry cannot be changed');
  }

  const updated = await prisma.labourEntry.update({
    where: { id: entryId },
    data: {
      ...(input.hoursWorked !== undefined && { hoursWorked: input.hoursWorked }),
      ...(mayWriteRate && input.dailyRate !== undefined && { dailyRate: input.dailyRate }),
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

  return presentEntry(updated, actor);
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
