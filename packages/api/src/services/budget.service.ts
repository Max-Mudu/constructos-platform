import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError, ConflictError, ValidationError } from '../utils/errors';
import { RequestUser } from '../types';
import { BudgetCategory, BudgetStatus } from '@prisma/client';

// ─── RBAC helpers ─────────────────────────────────────────────────────────────

const MANAGE_ROLES = ['company_admin', 'finance_officer', 'project_manager'] as const;

function canManage(actor: RequestUser): boolean {
  return (MANAGE_ROLES as readonly string[]).includes(actor.role);
}

function canFinanceApprove(actor: RequestUser): boolean {
  return actor.role === 'company_admin' || actor.role === 'finance_officer';
}

// ─── Financial authorisation (shared with invoice + dashboard services) ───────
//
// Owner policy for financial reads AND writes (invoices, budgets, dashboard
// money fields). canViewFinance is the authoritative finance permission:
//  - super_admin / company_admin / finance_officer: company-wide.
//  - project_manager: ONLY when the existing finance permission flag
//    (canViewFinance) is set, and then only for projects with an ACTIVE
//    membership (removedAt null). Membership alone never grants access.
//  - every other role (contractor, consultant, site_supervisor, viewer,
//    worker): no financial access, regardless of the canViewFinance flag.
// Writes apply the same scope ON TOP of their existing role rules (canManage /
// canFinanceApprove), so nobody can create or edit a record they cannot read.

const FINANCE_COMPANY_WIDE_ROLES: readonly string[] = ['super_admin', 'company_admin', 'finance_officer'];

/** `null` projectIds = every project in the actor's company. */
export type FinanceReadScope = { projectIds: string[] | null };

/** Returns the actor's financial read scope, or `null` when they have none. */
export async function getFinanceReadScope(actor: RequestUser): Promise<FinanceReadScope | null> {
  if (FINANCE_COMPANY_WIDE_ROLES.includes(actor.role)) return { projectIds: null };

  if (actor.role === 'project_manager' && actor.canViewFinance === true) {
    const memberships = await prisma.projectMember.findMany({
      where:  { userId: actor.id, companyId: actor.companyId, removedAt: null },
      select: { projectId: true },
    });
    return { projectIds: memberships.map((m) => m.projectId) };
  }

  return null;
}

/** Throws 403 when the actor has no financial read access at all. */
export async function requireFinanceReadScope(actor: RequestUser): Promise<FinanceReadScope> {
  const scope = await getFinanceReadScope(actor);
  if (!scope) throw new ForbiddenError('You do not have access to financial records');
  return scope;
}

/**
 * Builds the `projectId` where-clause for a scoped financial read, intersecting
 * an optional caller-supplied projectId filter with the actor's scope. An
 * out-of-scope filter yields an empty match, never a pass-through.
 */
export function financeProjectFilter(
  scope: FinanceReadScope,
  requestedProjectId?: string,
): string | { in: string[] } | undefined {
  if (scope.projectIds === null) return requestedProjectId || undefined;
  if (requestedProjectId) {
    return { in: scope.projectIds.includes(requestedProjectId) ? [requestedProjectId] : [] };
  }
  return { in: scope.projectIds };
}

export function isProjectInFinanceScope(scope: FinanceReadScope, projectId: string): boolean {
  return scope.projectIds === null || scope.projectIds.includes(projectId);
}

/**
 * Financial WRITE scope check for a budget's project. Same rule as reads, so
 * nobody can create or edit a financial record they cannot read:
 *  - no financial scope (incl. PM without canViewFinance) → 403
 *  - project outside scope (PM without an ACTIVE membership) → 404
 */
async function assertProjectAccess(actor: RequestUser, projectId: string): Promise<void> {
  const scope = await requireFinanceReadScope(actor);
  if (!isProjectInFinanceScope(scope, projectId)) throw new NotFoundError('Budget');
}

async function audit(
  actor: RequestUser,
  action: 'create' | 'update' | 'delete',
  entityType: string,
  entityId: string,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      companyId:  actor.companyId,
      userId:     actor.id,
      userEmail:  actor.email,
      userRole:   actor.role,
      action,
      entityType,
      entityId,
    },
  });
}

// ─── Input Types ──────────────────────────────────────────────────────────────

export interface CreateBudgetInput {
  projectId: string;
  name: string;
  currency?: string;
  notes?: string;
}

export interface UpdateBudgetInput {
  name?: string;
  currency?: string;
  notes?: string | null;
}

export interface CreateLineItemInput {
  category: BudgetCategory;
  description: string;
  quantity?: number;
  unit?: string;
  unitRate?: number;
  budgetedAmount: number;
  committedAmount?: number;
  actualSpend?: number;
  currency?: string;
  notes?: string;
  // For consultant category
  consultant?: {
    consultantType: string;
    consultantName: string;
    firmName?: string;
    feeAgreed: number;
    feePaid?: number;
    feeOutstanding?: number;
  };
  // For marketing category
  marketing?: {
    campaignName: string;
    channel: string;
    vendorAgency?: string;
    budgetedAmount: number;
    actualSpend?: number;
    paidAmount?: number;
    expectedRoi?: string;
    notes?: string;
  };
}

export interface UpdateLineItemInput {
  description?: string;
  quantity?: number | null;
  unit?: string | null;
  unitRate?: number | null;
  budgetedAmount?: number;
  committedAmount?: number;
  actualSpend?: number;
  notes?: string | null;
  consultant?: {
    consultantType?: string;
    consultantName?: string;
    firmName?: string | null;
    feeAgreed?: number;
    feePaid?: number;
    feeOutstanding?: number;
  };
  marketing?: {
    campaignName?: string;
    channel?: string;
    vendorAgency?: string | null;
    budgetedAmount?: number;
    actualSpend?: number;
    paidAmount?: number;
    expectedRoi?: string | null;
    notes?: string | null;
  };
}

export interface CreateVariationInput {
  referenceNumber: string;
  description: string;
  amount: number;
  direction?: 'addition' | 'omission';
}

export interface UpdateVariationInput {
  referenceNumber?: string;
  description?: string;
  amount?: number;
  direction?: 'addition' | 'omission';
  status?: 'pending' | 'approved' | 'rejected';
}

// ─── Selects ──────────────────────────────────────────────────────────────────

const LINE_ITEM_SELECT = {
  id:              true,
  budgetId:        true,
  companyId:       true,
  projectId:       true,
  category:        true,
  description:     true,
  quantity:        true,
  unit:            true,
  unitRate:        true,
  budgetedAmount:  true,
  committedAmount: true,
  actualSpend:     true,
  currency:        true,
  notes:           true,
  createdAt:       true,
  updatedAt:       true,
  consultantCostEntry: {
    select: {
      id:             true,
      consultantType: true,
      consultantName: true,
      firmName:       true,
      feeAgreed:      true,
      feePaid:        true,
      feeOutstanding: true,
      currency:       true,
    },
  },
  marketingBudgetEntry: {
    select: {
      id:             true,
      campaignName:   true,
      channel:        true,
      vendorAgency:   true,
      budgetedAmount: true,
      actualSpend:    true,
      paidAmount:     true,
      expectedRoi:    true,
      notes:          true,
    },
  },
} as const;

const VARIATION_SELECT = {
  id:              true,
  budgetId:        true,
  referenceNumber: true,
  description:     true,
  amount:          true,
  direction:       true,
  status:          true,
  requestedById:   true,
  approvedById:    true,
  approvedAt:      true,
  createdAt:       true,
  updatedAt:       true,
} as const;

const BUDGET_SELECT = {
  id:           true,
  companyId:    true,
  projectId:    true,
  name:         true,
  currency:     true,
  notes:        true,
  status:       true,
  createdById:  true,
  approvedById: true,
  approvedAt:   true,
  createdAt:    true,
  updatedAt:    true,
  project:      { select: { id: true, name: true, code: true } },
  createdBy:    { select: { id: true, firstName: true, lastName: true } },
  approvedBy:   { select: { id: true, firstName: true, lastName: true } },
  lineItems:    { select: LINE_ITEM_SELECT, orderBy: { createdAt: 'asc' as const } },
  variationOrders: { select: VARIATION_SELECT, orderBy: { createdAt: 'asc' as const } },
} as const;

const BUDGET_LIST_SELECT = {
  id:          true,
  companyId:   true,
  projectId:   true,
  name:        true,
  currency:    true,
  status:      true,
  approvedAt:  true,
  createdAt:   true,
  updatedAt:   true,
  project:     { select: { id: true, name: true, code: true } },
  createdBy:   { select: { id: true, firstName: true, lastName: true } },
  approvedBy:  { select: { id: true, firstName: true, lastName: true } },
  lineItems:   {
    select: {
      id:              true,
      category:        true,
      budgetedAmount:  true,
      committedAmount: true,
      actualSpend:     true,
    },
  },
} as const;

// ─── Budget CRUD ──────────────────────────────────────────────────────────────

export async function listBudgets(
  actor: RequestUser,
  filters: { projectId?: string; status?: BudgetStatus } = {},
) {
  const scope = await requireFinanceReadScope(actor);

  const where: Record<string, unknown> = { companyId: actor.companyId };
  if (filters.status) where.status = filters.status;

  const projectFilter = financeProjectFilter(scope, filters.projectId);
  if (projectFilter !== undefined) where.projectId = projectFilter;

  return prisma.budget.findMany({
    where,
    select: BUDGET_LIST_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getBudget(budgetId: string, actor: RequestUser) {
  const scope = await requireFinanceReadScope(actor);

  const where: Record<string, unknown> = { id: budgetId, companyId: actor.companyId };
  const projectFilter = financeProjectFilter(scope);
  if (projectFilter !== undefined) where.projectId = projectFilter;

  // Out-of-scope budgets are indistinguishable from missing ones (404).
  const budget = await prisma.budget.findFirst({ where, select: BUDGET_SELECT });
  if (!budget) throw new NotFoundError('Budget');

  return budget;
}

export async function createBudget(input: CreateBudgetInput, actor: RequestUser) {
  if (!canManage(actor)) throw new ForbiddenError('Only project managers, finance officers, and admins can create budgets');

  // Financial write scope: 403 without finance access, 404 outside scope.
  const scope = await requireFinanceReadScope(actor);

  const project = await prisma.project.findFirst({
    where: { id: input.projectId, companyId: actor.companyId },
  });
  if (!project || !isProjectInFinanceScope(scope, project.id)) throw new NotFoundError('Project');

  const existing = await prisma.budget.findUnique({ where: { projectId: input.projectId } });
  if (existing) throw new ConflictError('A budget already exists for this project');

  const budget = await prisma.budget.create({
    data: {
      companyId:   actor.companyId,
      projectId:   input.projectId,
      name:        input.name,
      currency:    input.currency ?? 'USD',
      notes:       input.notes ?? null,
      status:      'draft',
      createdById: actor.id,
    },
    select: BUDGET_SELECT,
  });

  await audit(actor, 'create', 'budget', budget.id);
  return budget;
}

export async function updateBudget(budgetId: string, input: UpdateBudgetInput, actor: RequestUser) {
  if (!canManage(actor)) throw new ForbiddenError('Insufficient permissions to update budgets');
  // Check finance scope before the lookup so 403/404 can't reveal whether the id exists.
  await requireFinanceReadScope(actor);

  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, companyId: actor.companyId },
  });
  if (!budget) throw new NotFoundError('Budget');
  await assertProjectAccess(actor, budget.projectId);
  if (budget.status === 'locked') throw new ForbiddenError('Budget is locked and cannot be edited');

  const updated = await prisma.budget.update({
    where: { id: budgetId },
    data: {
      ...(input.name     !== undefined && { name:     input.name }),
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.notes    !== undefined && { notes:    input.notes }),
    },
    select: BUDGET_SELECT,
  });

  await audit(actor, 'update', 'budget', budgetId);
  return updated;
}

export async function deleteBudget(budgetId: string, actor: RequestUser) {
  if (!canFinanceApprove(actor)) throw new ForbiddenError('Only admins and finance officers can delete budgets');

  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, companyId: actor.companyId },
  });
  if (!budget) throw new NotFoundError('Budget');

  await prisma.budget.delete({ where: { id: budgetId } });
  await audit(actor, 'delete', 'budget', budgetId);
}

export async function approveBudget(budgetId: string, actor: RequestUser) {
  if (!canFinanceApprove(actor)) throw new ForbiddenError('Only admins and finance officers can approve budgets');

  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, companyId: actor.companyId },
  });
  if (!budget) throw new NotFoundError('Budget');
  if (budget.status === 'approved') throw new ConflictError('Budget is already approved');

  const updated = await prisma.budget.update({
    where: { id: budgetId },
    data: {
      status:      'approved',
      approvedById: actor.id,
      approvedAt:  new Date(),
    },
    select: BUDGET_SELECT,
  });

  await audit(actor, 'update', 'budget', budgetId);
  return updated;
}

export async function lockBudget(budgetId: string, actor: RequestUser) {
  if (!canFinanceApprove(actor)) throw new ForbiddenError('Only admins and finance officers can lock budgets');

  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, companyId: actor.companyId },
  });
  if (!budget) throw new NotFoundError('Budget');
  if (budget.status !== 'approved') throw new ValidationError('Budget must be approved before locking');

  const updated = await prisma.budget.update({
    where: { id: budgetId },
    data: { status: 'locked' },
    select: BUDGET_SELECT,
  });

  await audit(actor, 'update', 'budget', budgetId);
  return updated;
}

// ─── Line Items ───────────────────────────────────────────────────────────────

export async function addLineItem(budgetId: string, input: CreateLineItemInput, actor: RequestUser) {
  if (!canManage(actor)) throw new ForbiddenError('Insufficient permissions to manage budget line items');
  await requireFinanceReadScope(actor);

  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, companyId: actor.companyId },
  });
  if (!budget) throw new NotFoundError('Budget');
  await assertProjectAccess(actor, budget.projectId);
  if (budget.status === 'locked') throw new ForbiddenError('Budget is locked');

  if (input.category === 'consultants' && !input.consultant) {
    throw new ValidationError('Consultant details are required for consultant category');
  }
  if (input.category === 'marketing' && !input.marketing) {
    throw new ValidationError('Marketing details are required for marketing category');
  }

  const lineItem = await prisma.budgetLineItem.create({
    data: {
      budgetId,
      companyId:       actor.companyId,
      projectId:       budget.projectId,
      category:        input.category,
      description:     input.description,
      quantity:        input.quantity   ?? null,
      unit:            input.unit       ?? null,
      unitRate:        input.unitRate   ?? null,
      budgetedAmount:  input.budgetedAmount,
      committedAmount: input.committedAmount ?? 0,
      actualSpend:     input.actualSpend     ?? 0,
      currency:        input.currency        ?? budget.currency,
      notes:           input.notes           ?? null,
      ...(input.consultant && {
        consultantCostEntry: {
          create: {
            companyId:      actor.companyId,
            projectId:      budget.projectId,
            consultantType: input.consultant.consultantType as import('@prisma/client').ConsultantType,
            consultantName: input.consultant.consultantName,
            firmName:       input.consultant.firmName ?? null,
            feeAgreed:      input.consultant.feeAgreed,
            feePaid:        input.consultant.feePaid       ?? 0,
            feeOutstanding: input.consultant.feeOutstanding ?? input.consultant.feeAgreed,
            currency:       input.currency ?? budget.currency,
          },
        },
      }),
      ...(input.marketing && {
        marketingBudgetEntry: {
          create: {
            companyId:      actor.companyId,
            projectId:      budget.projectId,
            campaignName:   input.marketing.campaignName,
            channel:        input.marketing.channel,
            vendorAgency:   input.marketing.vendorAgency ?? null,
            budgetedAmount: input.marketing.budgetedAmount,
            actualSpend:    input.marketing.actualSpend  ?? 0,
            paidAmount:     input.marketing.paidAmount   ?? 0,
            expectedRoi:    input.marketing.expectedRoi  ?? null,
            notes:          input.marketing.notes        ?? null,
          },
        },
      }),
    },
    select: LINE_ITEM_SELECT,
  });

  await audit(actor, 'create', 'budget_line_item', lineItem.id);
  return lineItem;
}

export async function updateLineItem(
  budgetId: string,
  lineItemId: string,
  input: UpdateLineItemInput,
  actor: RequestUser,
) {
  if (!canManage(actor)) throw new ForbiddenError('Insufficient permissions to manage budget line items');
  await requireFinanceReadScope(actor);

  const lineItem = await prisma.budgetLineItem.findFirst({
    where: { id: lineItemId, budgetId, companyId: actor.companyId },
    include: { consultantCostEntry: true, marketingBudgetEntry: true },
  });
  if (!lineItem) throw new NotFoundError('Budget line item');
  await assertProjectAccess(actor, lineItem.projectId);

  const budget = await prisma.budget.findUnique({ where: { id: budgetId } });
  if (budget?.status === 'locked') throw new ForbiddenError('Budget is locked');

  await prisma.budgetLineItem.update({
    where: { id: lineItemId },
    data: {
      ...(input.description    !== undefined && { description:     input.description }),
      ...(input.quantity       !== undefined && { quantity:        input.quantity }),
      ...(input.unit           !== undefined && { unit:            input.unit }),
      ...(input.unitRate       !== undefined && { unitRate:        input.unitRate }),
      ...(input.budgetedAmount !== undefined && { budgetedAmount:  input.budgetedAmount }),
      ...(input.committedAmount !== undefined && { committedAmount: input.committedAmount }),
      ...(input.actualSpend    !== undefined && { actualSpend:     input.actualSpend }),
      ...(input.notes          !== undefined && { notes:           input.notes }),
    },
  });

  if (input.consultant && lineItem.consultantCostEntry) {
    await prisma.consultantCostEntry.update({
      where: { id: lineItem.consultantCostEntry.id },
      data: {
        ...(input.consultant.consultantType  && { consultantType:  input.consultant.consultantType as import('@prisma/client').ConsultantType }),
        ...(input.consultant.consultantName  && { consultantName:  input.consultant.consultantName }),
        ...(input.consultant.firmName        !== undefined && { firmName:       input.consultant.firmName }),
        ...(input.consultant.feeAgreed       !== undefined && { feeAgreed:      input.consultant.feeAgreed }),
        ...(input.consultant.feePaid         !== undefined && { feePaid:        input.consultant.feePaid }),
        ...(input.consultant.feeOutstanding  !== undefined && { feeOutstanding: input.consultant.feeOutstanding }),
      },
    });
  }

  if (input.marketing && lineItem.marketingBudgetEntry) {
    await prisma.marketingBudgetEntry.update({
      where: { id: lineItem.marketingBudgetEntry.id },
      data: {
        ...(input.marketing.campaignName   && { campaignName:   input.marketing.campaignName }),
        ...(input.marketing.channel        && { channel:        input.marketing.channel }),
        ...(input.marketing.vendorAgency   !== undefined && { vendorAgency:   input.marketing.vendorAgency }),
        ...(input.marketing.budgetedAmount !== undefined && { budgetedAmount: input.marketing.budgetedAmount }),
        ...(input.marketing.actualSpend    !== undefined && { actualSpend:    input.marketing.actualSpend }),
        ...(input.marketing.paidAmount     !== undefined && { paidAmount:     input.marketing.paidAmount }),
        ...(input.marketing.expectedRoi    !== undefined && { expectedRoi:    input.marketing.expectedRoi }),
        ...(input.marketing.notes          !== undefined && { notes:          input.marketing.notes }),
      },
    });
  }

  await audit(actor, 'update', 'budget_line_item', lineItemId);

  return prisma.budgetLineItem.findUniqueOrThrow({
    where: { id: lineItemId },
    select: LINE_ITEM_SELECT,
  });
}

export async function deleteLineItem(budgetId: string, lineItemId: string, actor: RequestUser) {
  if (!canManage(actor)) throw new ForbiddenError('Insufficient permissions to manage budget line items');
  await requireFinanceReadScope(actor);

  const lineItem = await prisma.budgetLineItem.findFirst({
    where: { id: lineItemId, budgetId, companyId: actor.companyId },
  });
  if (!lineItem) throw new NotFoundError('Budget line item');
  // Previously missing: PMs could delete line items on any project's budget.
  await assertProjectAccess(actor, lineItem.projectId);

  const budget = await prisma.budget.findUnique({ where: { id: budgetId } });
  if (budget?.status === 'locked') throw new ForbiddenError('Budget is locked');

  await prisma.budgetLineItem.delete({ where: { id: lineItemId } });
  await audit(actor, 'delete', 'budget_line_item', lineItemId);
}

// ─── Variation Orders ─────────────────────────────────────────────────────────

export async function addVariation(budgetId: string, input: CreateVariationInput, actor: RequestUser) {
  if (!canManage(actor)) throw new ForbiddenError('Insufficient permissions to add variation orders');
  await requireFinanceReadScope(actor);

  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, companyId: actor.companyId },
  });
  if (!budget) throw new NotFoundError('Budget');

  await assertProjectAccess(actor, budget.projectId);

  const variation = await prisma.variationOrder.create({
    data: {
      budgetId,
      companyId:       actor.companyId,
      projectId:       budget.projectId,
      referenceNumber: input.referenceNumber,
      description:     input.description,
      amount:          input.amount,
      direction:       input.direction ?? 'addition',
      status:          'pending',
      requestedById:   actor.id,
    },
    select: VARIATION_SELECT,
  });

  await audit(actor, 'create', 'variation_order', variation.id);
  return variation;
}

export async function updateVariation(
  budgetId: string,
  variationId: string,
  input: UpdateVariationInput,
  actor: RequestUser,
) {
  await requireFinanceReadScope(actor);

  const variation = await prisma.variationOrder.findFirst({
    where: { id: variationId, budgetId, companyId: actor.companyId },
  });
  if (!variation) throw new NotFoundError('Variation order');
  // Requesters must still hold financial scope on the project (e.g. a PM who
  // lost canViewFinance or project membership can no longer edit it).
  await assertProjectAccess(actor, variation.projectId);

  const isRequester = variation.requestedById === actor.id;
  const isFinance   = canFinanceApprove(actor);
  if (!isRequester && !isFinance) throw new ForbiddenError('Insufficient permissions');

  if (input.status && input.status !== 'pending' && !isFinance) {
    throw new ForbiddenError('Only finance officers and admins can approve or reject variations');
  }

  const updated = await prisma.variationOrder.update({
    where: { id: variationId },
    data: {
      ...(input.referenceNumber !== undefined && { referenceNumber: input.referenceNumber }),
      ...(input.description     !== undefined && { description:     input.description }),
      ...(input.amount          !== undefined && { amount:          input.amount }),
      ...(input.direction       !== undefined && { direction:       input.direction }),
      ...(input.status          !== undefined && { status:          input.status }),
      ...(input.status === 'approved' && {
        approvedById: actor.id,
        approvedAt:   new Date(),
      }),
    },
    select: VARIATION_SELECT,
  });

  await audit(actor, 'update', 'variation_order', variationId);
  return updated;
}

// ─── Summary computation ──────────────────────────────────────────────────────

type BudgetWithLineItems = Awaited<ReturnType<typeof getBudget>>;

export function computeSummary(budget: BudgetWithLineItems) {
  const toNum = (d: import('@prisma/client').Prisma.Decimal | null | undefined) =>
    d == null ? 0 : Number(d);

  const lineItems = budget.lineItems;

  const totalBudgeted  = lineItems.reduce((s, li) => s + toNum(li.budgetedAmount),  0);
  const totalCommitted = lineItems.reduce((s, li) => s + toNum(li.committedAmount), 0);
  const totalSpent     = lineItems.reduce((s, li) => s + toNum(li.actualSpend),     0);
  const totalRemaining = totalBudgeted - totalSpent;
  const variance       = totalBudgeted - totalSpent;
  const overspend      = totalSpent > totalBudgeted;

  // Per-category breakdown
  const categories: Record<string, { budgeted: number; committed: number; spent: number }> = {};
  for (const li of lineItems) {
    const cat = li.category as string;
    if (!categories[cat]) categories[cat] = { budgeted: 0, committed: 0, spent: 0 };
    categories[cat].budgeted  += toNum(li.budgetedAmount);
    categories[cat].committed += toNum(li.committedAmount);
    categories[cat].spent     += toNum(li.actualSpend);
  }

  // Approved variation impact
  const approvedVariations = budget.variationOrders.filter((v) => v.status === 'approved');
  const variationImpact = approvedVariations.reduce((s, v) => {
    const amt = toNum(v.amount as import('@prisma/client').Prisma.Decimal);
    return v.direction === 'omission' ? s - amt : s + amt;
  }, 0);

  return {
    totalBudgeted,
    totalCommitted,
    totalSpent,
    totalRemaining,
    variance,
    overspend,
    variationImpact,
    adjustedBudget: totalBudgeted + variationImpact,
    categories,
  };
}
