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
  const now       = new Date();
  const todayStart = startOfDay(now);
  const weekStart  = startOfWeek(now);
  const monthStart = startOfMonth(now);

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
  const invoiceRows = await prisma.invoice.findMany({
    where:  { companyId },
    select: { status: true, totalAmount: true, paidAmount: true },
  });
  let invTotal = 0, invValue = 0, invPaid = 0, invOverdue = 0, invPending = 0;
  for (const inv of invoiceRows) {
    invTotal++;
    invValue   += Number(inv.totalAmount);
    invPaid    += Number(inv.paidAmount);
    if (inv.status === 'overdue')    invOverdue++;
    if (inv.status === 'submitted')  invPending++;
  }
  const invOutstanding = invValue - invPaid;

  // ── Budget ────────────────────────────────────────────────────────────────
  const allBudgets = await prisma.budget.findMany({
    where:   { companyId },
    include: { lineItems: { select: { budgetedAmount: true, actualSpend: true } } },
  });
  const budgetsCount  = allBudgets.length;
  let budgetTotal = 0, budgetSpent = 0;
  for (const b of allBudgets) {
    for (const li of b.lineItems) {
      budgetTotal += Number(li.budgetedAmount);
      budgetSpent += Number(li.actualSpend);
    }
  }
  const overspendCount = allBudgets.filter((b) =>
    b.lineItems.some((li) => Number(li.actualSpend) > Number(li.budgetedAmount)),
  ).length;

  // ── Deliveries ────────────────────────────────────────────────────────────
  const [monthDeliveries, pendingInspections, totalDeliveries] = await Promise.all([
    prisma.deliveryRecord.count({ where: { companyId, deliveryDate: { gte: monthStart } } }),
    prisma.deliveryRecord.count({ where: { companyId, inspectionStatus: 'pending' } }),
    prisma.deliveryRecord.count({ where: { companyId } }),
  ]);

  // ── Contractors ───────────────────────────────────────────────────────────
  const [contractorTotal, activeScheduleCount] = await Promise.all([
    prisma.contractor.count({ where: { companyId, isActive: true } }),
    prisma.contractorSchedule.count({ where: { companyId, status: 'active' } }),
  ]);

  // ── Instructions ──────────────────────────────────────────────────────────
  const [openInstructions, criticalInstructions] = await Promise.all([
    prisma.consultantInstruction.count({
      where: { companyId, status: { in: ['open', 'acknowledged', 'in_progress'] } },
    }),
    prisma.consultantInstruction.count({
      where: { companyId, priority: 'critical', status: { notIn: ['resolved', 'rejected'] } },
    }),
  ]);

  // ── Notifications (for this user) ─────────────────────────────────────────
  const unreadNotifications = await prisma.notification.count({
    where: { userId: actor.id, companyId, isRead: false },
  });

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
    finance,
  };
}
