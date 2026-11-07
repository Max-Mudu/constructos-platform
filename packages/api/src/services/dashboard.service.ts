import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { RequestUser } from '../types';
import { getFinanceReadScope, financeProjectFilter } from './budget.service';
import { resolveReadScope, scopeWhere, instructionScopeWhere, ReadScope } from './report.service';
import { workerReadScopeWhere } from './worker.service';
import { env } from '../utils/env';

// ─── Return type ──────────────────────────────────────────────────────────────

export interface DashboardStats {
  projects: {
    total:     number;
    active:    number;
    onHold:    number;
    planning:  number;
    completed: number;
    archived:  number;
    recent: Array<{
      id:        string;
      name:      string;
      code:      string | null;
      status:    string;
      location:  string | null;
      updatedAt: string;
    }>;
  };
  workers: {
    total:  number;
    active: number;
  };
  attendance: {
    todayTotal:   number;
    todayPresent: number;
    todayRate:    number;
  };
  // Financial fields below are `null` when the actor has no financial read
  // access (see getFinanceReadScope). For a project_manager with
  // canViewFinance they are scoped to the PM's active-member projects.
  labour: {
    thisWeekHours: number;
    thisMonthCost: number | null;
  };
  invoices: {
    total:           number | null;
    totalValue:      number | null;
    totalPaid:       number | null;
    outstanding:     number | null;
    overdueCount:    number | null;
    pendingApproval: number | null;
  };
  budget: {
    totalBudgeted:  number | null;
    totalSpent:     number | null;
    totalRemaining: number | null;
    budgetsCount:   number | null;
    overspendCount: number | null;
  };
  deliveries: {
    thisMonthCount:         number;
    pendingInspectionCount: number;
    totalCount:             number;
  };
  contractors: {
    total:           number;
    activeSchedules: number;
  };
  instructions: {
    open:     number;
    critical: number;
  };
  notifications: {
    unread: number;
  };
  lowStockInventory: {
    count: number;
    items: Array<{
      id:                string;
      materialName:      string;
      currentQuantity:   number;
      unitOfMeasure:     string;
      lowStockThreshold: number;
      siteName:          string;
    }>;
  };
  schedule: {
    overdueTasks:    number;
    dueTodayTasks:   number;
    blockedTasks:    number;
    delayedTasks:    number;
    behindPlanTasks: number;
  };
  labourAlerts: {
    absentToday:          number;
    lateToday:            number;
    overtimeEntriesToday: number;
    attendanceRateToday:  number;
    zeroWorkforceToday:   boolean;
  };
  procurementAlerts: {
    pendingDeliveriesCount:  number;
    rejectedLast30dCount:    number;
    damagedLast30dCount:     number;
    lowStockNoDeliveryCount: number;
    lowStockSeverityItems: Array<{
      materialName:      string;
      currentQuantity:   number;
      lowStockThreshold: number;
      unitOfMeasure:     string;
      siteName:          string;
    }>;
  };
  /** Only present for company_admin / finance_officer with canViewFinance */
  finance?: {
    totalInflows:     number;
    inflowsThisMonth: number;
    netPosition:      number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  const day = r.getDay(); // 0 = Sunday
  r.setDate(r.getDate() - day);
  r.setHours(0, 0, 0, 0);
  return r;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

// ─── Read scope ───────────────────────────────────────────────────────────────
//
// Every non-financial figure is limited to what the caller may read elsewhere:
//  - company-wide roles (super_admin, company_admin, finance_officer): the
//    whole company, as before;
//  - other roles: their active project memberships, narrowed to assigned
//    sites for site-scoped roles (resolveReadScope / scopeWhere, the same
//    rules as reports and the per-project lists); worker counts follow
//    GET /workers (workerReadScopeWhere);
//  - contractor: additionally only their own contractor record, schedules,
//    tasks and instructions (as the contractor-facing lists);
//  - worker: their own projects, attendance and labour only; other
//    operational figures are zero.
// Financial blocks keep their own gate (getFinanceReadScope), unchanged.

/** Matches no rows (Prisma treats `in: []` as false). */
const NONE = { id: { in: [] as string[] } };

interface DashboardScope {
  projects:     Prisma.ProjectWhereInput;
  workers:      Prisma.WorkerWhereInput;
  attendance:   Prisma.AttendanceRecordWhereInput;
  labour:       Prisma.LabourEntryWhereInput;
  deliveries:   Prisma.DeliveryRecordWhereInput;
  contractors:  Prisma.ContractorWhereInput;
  schedules:    Prisma.ContractorScheduleWhereInput;
  instructions: Prisma.ConsultantInstructionWhereInput;
  inventory:    Prisma.SiteInventoryWhereInput;
  tasks:        Prisma.ScheduleTaskWhereInput;
}

/** Job-site filter equivalent to scopeWhere(scope) on (projectId, siteId) rows. */
function jobSiteWhere(scope: ReadScope): Prisma.JobSiteWhereInput {
  if (scope.projectIds === null) return {};
  const unrestricted = scope.projectIds.filter((pid) => !scope.siteRestrictions.has(pid));
  return {
    OR: [
      { projectId: { in: unrestricted } },
      ...Array.from(scope.siteRestrictions, ([pid, sites]) => ({ projectId: pid, id: { in: sites } })),
    ],
  };
}

async function resolveDashboardScope(actor: RequestUser): Promise<DashboardScope> {
  const scope = await resolveReadScope(actor, {});

  if (scope.projectIds === null) {
    return {
      projects: {}, workers: {}, attendance: {}, labour: {}, deliveries: {},
      contractors: {}, schedules: {}, instructions: {}, inventory: {}, tasks: {},
    };
  }

  const projects: Prisma.ProjectWhereInput = { id: { in: scope.projectIds } };
  const siteRows    = scopeWhere(scope);
  const projectRows = scopeWhere(scope, { siteColumn: false });

  if (actor.role === 'worker') {
    const own = await prisma.worker.findFirst({
      where:  { companyId: actor.companyId, userId: actor.id },
      select: { id: true },
    });
    const ownRows = own ? { workerId: own.id, ...siteRows } : NONE;
    return {
      projects,
      workers:      own ? { id: own.id } : NONE,
      attendance:   ownRows,
      labour:       ownRows,
      deliveries:   NONE,
      contractors:  NONE,
      schedules:    NONE,
      instructions: NONE,
      inventory:    NONE,
      tasks:        NONE,
    };
  }

  const sites = await prisma.jobSite.findMany({
    where:  { companyId: actor.companyId, ...jobSiteWhere(scope) },
    select: { id: true },
  });

  // Instructions follow instruction.service: site limits apply only under
  // SITE_SCOPE_STRICT (getDocumentSiteIds); otherwise project membership.
  const instructions: Prisma.ConsultantInstructionWhereInput = env.SITE_SCOPE_STRICT
    ? instructionScopeWhere(scope, actor.id)
    : projectRows;

  // A contractor sees only records linked to their own contractor record
  // (as GET /contractors, schedules and instructions do).
  if (actor.role === 'contractor') {
    const own = { contractor: { userId: actor.id, companyId: actor.companyId } };
    return {
      projects,
      workers:      await workerReadScopeWhere(actor),
      attendance:   siteRows,
      labour:       siteRows,
      deliveries:   siteRows,
      contractors:  { userId: actor.id },
      schedules:    { ...projectRows, ...own },
      instructions: { AND: [instructions, own] },
      inventory:    { siteId: { in: sites.map((s) => s.id) } },
      tasks:        { ...siteRows, ...own },
    };
  }

  return {
    projects,
    workers:      await workerReadScopeWhere(actor),
    attendance:   siteRows,
    labour:       siteRows,
    deliveries:   siteRows,
    // Contractors engaged on the projects / sites in scope.
    contractors:  { OR: [{ schedules: { some: projectRows } }, { scheduleTasks: { some: siteRows } }] },
    schedules:    projectRows,
    instructions,
    inventory:    { siteId: { in: sites.map((s) => s.id) } },
    tasks:        siteRows,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export async function getDashboardStats(actor: RequestUser): Promise<DashboardStats> {
  const { companyId } = actor;
  const now          = new Date();
  const todayStart   = startOfDay(now);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const weekStart     = startOfWeek(now);
  const monthStart    = startOfMonth(now);
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const sc = await resolveDashboardScope(actor);

  // ── Projects ──────────────────────────────────────────────────────────────
  const [projectRows, recentProjects] = await Promise.all([
    prisma.project.groupBy({
      by:    ['status'],
      where: { companyId, ...sc.projects },
      _count: { _all: true },
    }),
    prisma.project.findMany({
      where:   { companyId, ...sc.projects },
      select:  { id: true, name: true, code: true, status: true, location: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take:    5,
    }),
  ]);

  const projectByStatus: Record<string, number> = {};
  let projectTotal = 0;
  for (const row of projectRows) {
    projectByStatus[row.status] = row._count._all;
    projectTotal += row._count._all;
  }

  // ── Workers ───────────────────────────────────────────────────────────────
  const [workerTotal, workerActive] = await Promise.all([
    prisma.worker.count({ where: { companyId, AND: [sc.workers] } }),
    prisma.worker.count({ where: { companyId, isActive: true, employmentStatus: 'active', AND: [sc.workers] } }),
  ]);

  // ── Attendance (today) ────────────────────────────────────────────────────
  const todayAttendance = await prisma.attendanceRecord.groupBy({
    by:    ['status'],
    where: { companyId, ...sc.attendance, date: { gte: todayStart } },
    _count: { _all: true },
  });
  const todayTotal   = todayAttendance.reduce((s, r) => s + r._count._all, 0);
  const todayPresent = todayAttendance
    .filter((r) => r.status === 'present' || r.status === 'late' || r.status === 'half_day')
    .reduce((s, r) => s + r._count._all, 0);
  const todayRate    = todayTotal > 0 ? Math.round((todayPresent / todayTotal) * 100) : 0;

  // ── Labour hours (operational, unchanged) ─────────────────────────────────
  const weekLabour = await prisma.labourEntry.aggregate({
    where:  { companyId, ...sc.labour, date: { gte: weekStart } },
    _sum:   { hoursWorked: true },
  });
  const thisWeekHours = Number(weekLabour._sum.hoursWorked ?? 0);

  // ── Financial aggregates (gated + project-scoped) ─────────────────────────
  // Labour cost, invoices and budgets are only computed for actors with a
  // financial read scope. Everyone else gets these fields as null.
  const financeScope = await getFinanceReadScope(actor);

  type FinancialBlocks = {
    labour:   { thisMonthCost: number };
    invoices: DashboardStats['invoices'];
    budget:   DashboardStats['budget'];
    invOutstanding: number;
  };
  let fin: FinancialBlocks | null = null;

  if (financeScope) {
    const projectFilter = financeProjectFilter(financeScope);
    const scoped = projectFilter !== undefined
      ? { companyId, projectId: projectFilter }
      : { companyId };

    const [monthLabour, invAgg, invByStatus, budgetLineAgg, budgetsCount, overspendBudgetData] = await Promise.all([
      prisma.labourEntry.aggregate({
        where:  { ...scoped, date: { gte: monthStart } },
        _sum:   { dailyRate: true },
      }),
      prisma.invoice.aggregate({
        where:  scoped,
        _sum:   { totalAmount: true, paidAmount: true },
        _count: { _all: true },
      }),
      prisma.invoice.groupBy({
        by:    ['status'],
        where: scoped,
        _count: { _all: true },
      }),
      prisma.budgetLineItem.aggregate({
        where: { budget: scoped },
        _sum:  { budgetedAmount: true, actualSpend: true },
      }),
      prisma.budget.count({ where: scoped }),
      prisma.budget.findMany({
        where:  scoped,
        select: { lineItems: { select: { budgetedAmount: true, actualSpend: true } } },
      }),
    ]);

    const invValue       = Number(invAgg._sum.totalAmount ?? 0);
    const invPaid        = Number(invAgg._sum.paidAmount  ?? 0);
    const invOutstanding = invValue - invPaid;
    const budgetTotal    = Number(budgetLineAgg._sum.budgetedAmount ?? 0);
    const budgetSpent    = Number(budgetLineAgg._sum.actualSpend    ?? 0);

    fin = {
      labour: { thisMonthCost: Number(monthLabour._sum.dailyRate ?? 0) },
      invoices: {
        total:           invAgg._count._all,
        totalValue:      invValue,
        totalPaid:       invPaid,
        outstanding:     invOutstanding,
        overdueCount:    invByStatus.find((r) => r.status === 'overdue')?._count._all   ?? 0,
        pendingApproval: invByStatus.find((r) => r.status === 'submitted')?._count._all ?? 0,
      },
      budget: {
        totalBudgeted:  budgetTotal,
        totalSpent:     budgetSpent,
        totalRemaining: budgetTotal - budgetSpent,
        budgetsCount,
        overspendCount: overspendBudgetData.filter((b) =>
          b.lineItems.some((li) => Number(li.actualSpend) > Number(li.budgetedAmount)),
        ).length,
      },
      invOutstanding,
    };
  }

  // ── Deliveries ────────────────────────────────────────────────────────────
  const [monthDeliveries, pendingInspections, totalDeliveries] = await Promise.all([
    prisma.deliveryRecord.count({ where: { companyId, ...sc.deliveries, deliveryDate: { gte: monthStart } } }),
    prisma.deliveryRecord.count({ where: { companyId, ...sc.deliveries, inspectionStatus: 'pending' } }),
    prisma.deliveryRecord.count({ where: { companyId, ...sc.deliveries } }),
  ]);

  // ── Procurement alerts ────────────────────────────────────────────────────
  const [rejectedLast30d, damagedLast30d, pendingDeliveryList] = await Promise.all([
    prisma.deliveryRecord.count({
      where: { companyId, ...sc.deliveries, acceptanceStatus: 'rejected', deliveryDate: { gte: thirtyDaysAgo } },
    }),
    prisma.deliveryRecord.count({
      where: {
        companyId,
        ...sc.deliveries,
        conditionOnArrival: { in: ['damaged', 'partial', 'incorrect'] },
        deliveryDate: { gte: thirtyDaysAgo },
      },
    }),
    prisma.deliveryRecord.findMany({
      where:  { companyId, ...sc.deliveries, inspectionStatus: 'pending' },
      select: { siteId: true, itemDescription: true },
      take:   1000,
    }),
  ]);

  // ── Contractors ───────────────────────────────────────────────────────────
  const [contractorTotal, activeScheduleCount] = await Promise.all([
    prisma.contractor.count({ where: { companyId, isActive: true, AND: [sc.contractors] } }),
    prisma.contractorSchedule.count({ where: { companyId, ...sc.schedules, status: 'active' } }),
  ]);

  // ── Instructions, notifications, and low-stock ────────────────────────────
  const [openInstructions, criticalInstructions, unreadNotifications, inventoryWithThreshold] = await Promise.all([
    prisma.consultantInstruction.count({
      where: { companyId, status: { in: ['open', 'acknowledged', 'in_progress'] }, AND: [sc.instructions] },
    }),
    prisma.consultantInstruction.count({
      where: { companyId, priority: 'critical', status: { notIn: ['resolved', 'rejected'] }, AND: [sc.instructions] },
    }),
    prisma.notification.count({
      where: { userId: actor.id, companyId, isRead: false },
    }),
    prisma.siteInventory.findMany({
      where:  { companyId, lowStockThreshold: { not: null }, AND: [sc.inventory] },
      take:   500,
      select: {
        id:                true,
        siteId:            true,
        materialName:      true,
        currentQuantity:   true,
        unitOfMeasure:     true,
        lowStockThreshold: true,
        site:              { select: { name: true } },
      },
    }),
  ]);
  const lowStockRows = inventoryWithThreshold
    .filter((i) => i.currentQuantity.lte(i.lowStockThreshold!))
    .sort((a, b) => Number(a.currentQuantity) - Number(b.currentQuantity))
    .slice(0, 10)
    .map((i) => ({
      id:                i.id,
      materialName:      i.materialName,
      currentQuantity:   Number(i.currentQuantity),
      unitOfMeasure:     i.unitOfMeasure,
      lowStockThreshold: Number(i.lowStockThreshold),
      siteName:          i.site.name,
    }));

  const allLowStockItems = inventoryWithThreshold.filter((i) => i.currentQuantity.lte(i.lowStockThreshold!));
  const pendingDeliverySet = new Set(
    pendingDeliveryList.map((d) => `${d.siteId}:${d.itemDescription.toLowerCase().trim()}`),
  );
  const lowStockNoDeliveryCount = allLowStockItems.filter(
    (i) => !pendingDeliverySet.has(`${i.siteId}:${i.materialName.toLowerCase().trim()}`),
  ).length;
  const lowStockSeverityItems = allLowStockItems
    .slice()
    .sort(
      (a, b) =>
        Number(a.currentQuantity) / Number(a.lowStockThreshold) -
        Number(b.currentQuantity) / Number(b.lowStockThreshold),
    )
    .slice(0, 5)
    .map((i) => ({
      materialName:      i.materialName,
      currentQuantity:   Number(i.currentQuantity),
      lowStockThreshold: Number(i.lowStockThreshold),
      unitOfMeasure:     i.unitOfMeasure,
      siteName:          i.site.name,
    }));

  // ── Schedule risk ─────────────────────────────────────────────────────────
  const [overdueTasks, dueTodayTasks, blockedTasks, delayedTasks, taskProgressRows, overtimeEntriesToday] = await Promise.all([
    prisma.scheduleTask.count({
      where: { companyId, ...sc.tasks, status: { not: 'completed' }, plannedEndDate: { lt: todayStart } },
    }),
    prisma.scheduleTask.count({
      where: { companyId, ...sc.tasks, status: { not: 'completed' }, plannedEndDate: { gte: todayStart, lt: tomorrowStart } },
    }),
    prisma.scheduleTask.count({
      where: { companyId, ...sc.tasks, status: 'blocked' },
    }),
    prisma.scheduleTask.count({
      where: { companyId, ...sc.tasks, status: 'delayed' },
    }),
    prisma.scheduleTask.findMany({
      where:  { companyId, ...sc.tasks, actualProgress: { not: null }, plannedProgress: { not: null } },
      select: { actualProgress: true, plannedProgress: true },
      take:   2000,
    }),
    prisma.labourEntry.count({
      where: { companyId, ...sc.labour, date: { gte: todayStart, lt: tomorrowStart }, hoursWorked: { gt: 8 } },
    }),
  ]);
  const behindPlanTasks = taskProgressRows.filter(
    (t) => Number(t.actualProgress) < Number(t.plannedProgress) - 10,
  ).length;

  // ── Labour alerts ──────────────────────────────────────────────────────────
  const absentToday        = todayAttendance.find((r) => r.status === 'absent')?._count._all ?? 0;
  const lateToday          = todayAttendance.find((r) => r.status === 'late')?._count._all   ?? 0;
  const attendanceRateToday = todayRate;
  const zeroWorkforceToday  = todayPresent === 0 && todayTotal > 0;

  // ── Finance (gated) ───────────────────────────────────────────────────────
  let finance: DashboardStats['finance'];
  // Unchanged gate. company_admin / finance_officer always have a company-wide
  // finance scope, so `fin` is populated (company-wide) whenever this runs.
  if (
    fin &&
    actor.canViewFinance &&
    (actor.role === 'company_admin' || actor.role === 'finance_officer')
  ) {
    const [totalInflowsAgg, monthInflowsAgg] = await Promise.all([
      prisma.financeInflow.aggregate({
        where: { companyId },
        _sum:  { amount: true },
      }),
      prisma.financeInflow.aggregate({
        where: { companyId, transactionDate: { gte: monthStart } },
        _sum:  { amount: true },
      }),
    ]);
    const totalInflows    = Number(totalInflowsAgg._sum.amount ?? 0);
    const inflowsThisMonth = Number(monthInflowsAgg._sum.amount ?? 0);
    finance = {
      totalInflows,
      inflowsThisMonth,
      netPosition: totalInflows - fin.invOutstanding,
    };
  }

  return {
    projects: {
      total:     projectTotal,
      active:    projectByStatus['active']    ?? 0,
      onHold:    projectByStatus['on_hold']   ?? 0,
      planning:  projectByStatus['planning']  ?? 0,
      completed: projectByStatus['completed'] ?? 0,
      archived:  projectByStatus['archived']  ?? 0,
      recent:    recentProjects.map((p) => ({
        id:        p.id,
        name:      p.name,
        code:      p.code,
        status:    p.status,
        location:  p.location,
        updatedAt: p.updatedAt.toISOString(),
      })),
    },
    workers: {
      total:  workerTotal,
      active: workerActive,
    },
    attendance: {
      todayTotal,
      todayPresent,
      todayRate,
    },
    labour: {
      thisWeekHours,
      thisMonthCost: fin ? fin.labour.thisMonthCost : null,
    },
    // Keys are always present (backward-compatible shape); values are null
    // when the actor has no financial read access.
    invoices: fin ? fin.invoices : {
      total:           null,
      totalValue:      null,
      totalPaid:       null,
      outstanding:     null,
      overdueCount:    null,
      pendingApproval: null,
    },
    budget: fin ? fin.budget : {
      totalBudgeted:  null,
      totalSpent:     null,
      totalRemaining: null,
      budgetsCount:   null,
      overspendCount: null,
    },
    deliveries: {
      thisMonthCount:         monthDeliveries,
      pendingInspectionCount: pendingInspections,
      totalCount:             totalDeliveries,
    },
    contractors: {
      total:           contractorTotal,
      activeSchedules: activeScheduleCount,
    },
    instructions: {
      open:     openInstructions,
      critical: criticalInstructions,
    },
    notifications: {
      unread: unreadNotifications,
    },
    lowStockInventory: {
      count: lowStockRows.length,
      items: lowStockRows,
    },
    schedule: {
      overdueTasks,
      dueTodayTasks,
      blockedTasks,
      delayedTasks,
      behindPlanTasks,
    },
    labourAlerts: {
      absentToday,
      lateToday,
      overtimeEntriesToday,
      attendanceRateToday,
      zeroWorkforceToday,
    },
    procurementAlerts: {
      pendingDeliveriesCount:  pendingInspections,
      rejectedLast30dCount:    rejectedLast30d,
      damagedLast30dCount:     damagedLast30d,
      lowStockNoDeliveryCount,
      lowStockSeverityItems,
    },
    finance,
  };
}
