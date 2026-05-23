import { prisma } from '../utils/prisma';
import { RequestUser } from '../types';

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
  labour: {
    thisWeekHours: number;
    thisMonthCost: number;
  };
  invoices: {
    total:           number;
    totalValue:      number;
    totalPaid:       number;
    outstanding:     number;
    overdueCount:    number;
    pendingApproval: number;
  };
  budget: {
    totalBudgeted:  number;
    totalSpent:     number;
    totalRemaining: number;
    budgetsCount:   number;
    overspendCount: number;
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

  // ── Projects ──────────────────────────────────────────────────────────────
  const [projectRows, recentProjects] = await Promise.all([
    prisma.project.groupBy({
      by:    ['status'],
      where: { companyId },
      _count: { _all: true },
    }),
    prisma.project.findMany({
      where:   { companyId },
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
    prisma.worker.count({ where: { companyId } }),
    prisma.worker.count({ where: { companyId, isActive: true, employmentStatus: 'active' } }),
  ]);

  // ── Attendance (today) ────────────────────────────────────────────────────
  const todayAttendance = await prisma.attendanceRecord.groupBy({
    by:    ['status'],
    where: { companyId, date: { gte: todayStart } },
    _count: { _all: true },
  });
  const todayTotal   = todayAttendance.reduce((s, r) => s + r._count._all, 0);
  const todayPresent = todayAttendance
    .filter((r) => r.status === 'present' || r.status === 'late' || r.status === 'half_day')
    .reduce((s, r) => s + r._count._all, 0);
  const todayRate    = todayTotal > 0 ? Math.round((todayPresent / todayTotal) * 100) : 0;

  // ── Labour ────────────────────────────────────────────────────────────────
  const [weekLabour, monthLabour] = await Promise.all([
    prisma.labourEntry.aggregate({
      where:  { companyId, date: { gte: weekStart } },
      _sum:   { hoursWorked: true },
    }),
    prisma.labourEntry.aggregate({
      where:  { companyId, date: { gte: monthStart } },
      _sum:   { dailyRate: true },
    }),
  ]);
  const thisWeekHours = Number(weekLabour._sum.hoursWorked ?? 0);
  const thisMonthCost = Number(monthLabour._sum.dailyRate  ?? 0);

  // ── Invoices ──────────────────────────────────────────────────────────────
  const [invAgg, invByStatus] = await Promise.all([
    prisma.invoice.aggregate({
      where:  { companyId },
      _sum:   { totalAmount: true, paidAmount: true },
      _count: { _all: true },
    }),
    prisma.invoice.groupBy({
      by:    ['status'],
      where: { companyId },
      _count: { _all: true },
    }),
  ]);
  const invTotal       = invAgg._count._all;
  const invValue       = Number(invAgg._sum.totalAmount ?? 0);
  const invPaid        = Number(invAgg._sum.paidAmount  ?? 0);
  const invOutstanding = invValue - invPaid;
  const invOverdue     = invByStatus.find((r) => r.status === 'overdue')?._count._all  ?? 0;
  const invPending     = invByStatus.find((r) => r.status === 'submitted')?._count._all ?? 0;

  // ── Budget ────────────────────────────────────────────────────────────────
  const [budgetLineAgg, budgetsCount, overspendBudgetData] = await Promise.all([
    prisma.budgetLineItem.aggregate({
      where: { budget: { companyId } },
      _sum:  { budgetedAmount: true, actualSpend: true },
    }),
    prisma.budget.count({ where: { companyId } }),
    prisma.budget.findMany({
      where:  { companyId },
      select: { lineItems: { select: { budgetedAmount: true, actualSpend: true } } },
    }),
  ]);
  const budgetTotal    = Number(budgetLineAgg._sum.budgetedAmount ?? 0);
  const budgetSpent    = Number(budgetLineAgg._sum.actualSpend    ?? 0);
  const overspendCount = overspendBudgetData.filter((b) =>
    b.lineItems.some((li) => Number(li.actualSpend) > Number(li.budgetedAmount)),
  ).length;

  // ── Deliveries ────────────────────────────────────────────────────────────
  const [monthDeliveries, pendingInspections, totalDeliveries] = await Promise.all([
    prisma.deliveryRecord.count({ where: { companyId, deliveryDate: { gte: monthStart } } }),
    prisma.deliveryRecord.count({ where: { companyId, inspectionStatus: 'pending' } }),
    prisma.deliveryRecord.count({ where: { companyId } }),
  ]);

  // ── Procurement alerts ────────────────────────────────────────────────────
  const [rejectedLast30d, damagedLast30d, pendingDeliveryList] = await Promise.all([
    prisma.deliveryRecord.count({
      where: { companyId, acceptanceStatus: 'rejected', deliveryDate: { gte: thirtyDaysAgo } },
    }),
    prisma.deliveryRecord.count({
      where: {
        companyId,
        conditionOnArrival: { in: ['damaged', 'partial', 'incorrect'] },
        deliveryDate: { gte: thirtyDaysAgo },
      },
    }),
    prisma.deliveryRecord.findMany({
      where:  { companyId, inspectionStatus: 'pending' },
      select: { siteId: true, itemDescription: true },
      take:   1000,
    }),
  ]);

  // ── Contractors ───────────────────────────────────────────────────────────
  const [contractorTotal, activeScheduleCount] = await Promise.all([
    prisma.contractor.count({ where: { companyId, isActive: true } }),
    prisma.contractorSchedule.count({ where: { companyId, status: 'active' } }),
  ]);

  // ── Instructions, notifications, and low-stock ────────────────────────────
  const [openInstructions, criticalInstructions, unreadNotifications, inventoryWithThreshold] = await Promise.all([
    prisma.consultantInstruction.count({
      where: { companyId, status: { in: ['open', 'acknowledged', 'in_progress'] } },
    }),
    prisma.consultantInstruction.count({
      where: { companyId, priority: 'critical', status: { notIn: ['resolved', 'rejected'] } },
    }),
    prisma.notification.count({
      where: { userId: actor.id, companyId, isRead: false },
    }),
    prisma.siteInventory.findMany({
      where:  { companyId, lowStockThreshold: { not: null } },
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
      where: { companyId, status: { not: 'completed' }, plannedEndDate: { lt: todayStart } },
    }),
    prisma.scheduleTask.count({
      where: { companyId, status: { not: 'completed' }, plannedEndDate: { gte: todayStart, lt: tomorrowStart } },
    }),
    prisma.scheduleTask.count({
      where: { companyId, status: 'blocked' },
    }),
    prisma.scheduleTask.count({
      where: { companyId, status: 'delayed' },
    }),
    prisma.scheduleTask.findMany({
      where:  { companyId, actualProgress: { not: null }, plannedProgress: { not: null } },
      select: { actualProgress: true, plannedProgress: true },
      take:   2000,
    }),
    prisma.labourEntry.count({
      where: { companyId, date: { gte: todayStart, lt: tomorrowStart }, hoursWorked: { gt: 8 } },
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
  if (
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
      netPosition: totalInflows - invOutstanding,
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
      thisMonthCost,
    },
    invoices: {
      total:           invTotal,
      totalValue:      invValue,
      totalPaid:       invPaid,
      outstanding:     invOutstanding,
      overdueCount:    invOverdue,
      pendingApproval: invPending,
    },
    budget: {
      totalBudgeted:  budgetTotal,
      totalSpent:     budgetSpent,
      totalRemaining: budgetTotal - budgetSpent,
      budgetsCount,
      overspendCount,
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
