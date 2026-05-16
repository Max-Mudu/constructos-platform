import { prisma } from '../utils/prisma';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { RequestUser } from '../types';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ReportFilters {
  projectId?: string;
  siteId?: string;
  startDate?: string;
  endDate?: string;
}

export interface ReportData {
  title:       string;
  subtitle:    string;
  generatedAt: string;
  filters:     Record<string, string>;
  summary:     Array<{ label: string; value: string }>;
  columns:     string[];
  rows:        string[][];
}

export type ReportType =
  | 'labour'
  | 'budget'
  | 'invoices'
  | 'deliveries'
  | 'contractors'
  | 'consultants'
  | 'project-health'
  | 'daily-site-report';

// ─── RBAC map ─────────────────────────────────────────────────────────────────

const REPORT_ROLES: Record<ReportType, string[]> = {
  'labour':         ['company_admin', 'finance_officer', 'project_manager', 'site_supervisor'],
  'budget':         ['company_admin', 'finance_officer', 'project_manager'],
  'invoices':       ['company_admin', 'finance_officer', 'project_manager', 'contractor', 'consultant'],
  'deliveries':     ['company_admin', 'finance_officer', 'project_manager', 'site_supervisor'],
  'contractors':    ['company_admin', 'project_manager', 'site_supervisor'],
  'consultants':    ['company_admin', 'project_manager', 'consultant'],
  'project-health':      ['company_admin', 'finance_officer', 'project_manager'],
  'daily-site-report':  ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'],
};

export function assertReportAccess(type: ReportType, actor: RequestUser): void {
  const allowed = REPORT_ROLES[type];
  if (!allowed.includes(actor.role)) {
    throw new ForbiddenError(`Role '${actor.role}' cannot access the ${type} report`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

function buildDateFilter(filters: ReportFilters): { gte?: Date; lte?: Date } | undefined {
  if (!filters.startDate && !filters.endDate) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (filters.startDate) range.gte = new Date(filters.startDate);
  if (filters.endDate)   range.lte = new Date(filters.endDate);
  return range;
}

function buildActiveFilters(filters: ReportFilters): Record<string, string> {
  const result: Record<string, string> = {};
  if (filters.projectId) result['Project ID'] = filters.projectId;
  if (filters.siteId)    result['Site ID']    = filters.siteId;
  if (filters.startDate) result['From']       = filters.startDate;
  if (filters.endDate)   result['To']         = filters.endDate;
  return result;
}

// ─── Report functions ─────────────────────────────────────────────────────────

export async function labourReport(
  actor: RequestUser,
  filters: ReportFilters,
): Promise<ReportData> {
  const { companyId } = actor;
  const dateRange = buildDateFilter(filters);

  const entries = await prisma.labourEntry.findMany({
    where: {
      companyId,
      ...(filters.projectId && { projectId: filters.projectId }),
      ...(filters.siteId    && { siteId: filters.siteId }),
      ...(dateRange          && { date: dateRange }),
    },
    include: {
      worker: { select: { firstName: true, lastName: true, trade: true } },
    },
    orderBy: [{ date: 'desc' }],
  });

  const totalHours = entries.reduce((s, e) => s + Number(e.hoursWorked), 0);
  const totalCost  = entries.reduce((s, e) => s + Number(e.dailyRate), 0);

  const rows = entries.map((e) => [
    fmtDate(e.date),
    `${e.worker.firstName} ${e.worker.lastName}`,
    e.worker.trade ?? '',
    fmt(Number(e.hoursWorked), 1),
    fmt(Number(e.dailyRate)),
    e.currency,
    e.notes ?? '',
  ]);

  return {
    title:       'Labour Report',
    subtitle:    `Company labour entries${filters.projectId ? ' for project' : ''}`,
    generatedAt: new Date().toISOString(),
    filters:     buildActiveFilters(filters),
    summary: [
      { label: 'Total Entries',  value: String(entries.length) },
      { label: 'Total Hours',    value: fmt(totalHours, 1) },
      { label: 'Total Cost',     value: fmt(totalCost) },
    ],
    columns: ['Date', 'Worker', 'Trade', 'Hours', 'Daily Rate', 'Currency', 'Notes'],
    rows,
  };
}

export async function budgetReport(
  actor: RequestUser,
  filters: ReportFilters,
): Promise<ReportData> {
  const { companyId } = actor;

  const budgets = await prisma.budget.findMany({
    where: {
      companyId,
      ...(filters.projectId && { projectId: filters.projectId }),
    },
    include: {
      project: { select: { name: true } },
      lineItems: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  let totalBudgeted = 0;
  let totalSpent    = 0;
  const rows: string[][] = [];

  for (const budget of budgets) {
    for (const li of budget.lineItems) {
      const budgeted = Number(li.budgetedAmount);
      const spent    = Number(li.actualSpend);
      totalBudgeted += budgeted;
      totalSpent    += spent;
      rows.push([
        budget.project.name,
        budget.name,
        li.category,
        li.description,
        fmt(budgeted),
        fmt(Number(li.committedAmount)),
        fmt(spent),
        fmt(budgeted - spent),
        li.currency,
      ]);
    }
  }

  return {
    title:       'Budget Report',
    subtitle:    'Budget line items and spend summary',
    generatedAt: new Date().toISOString(),
    filters:     buildActiveFilters(filters),
    summary: [
      { label: 'Budgets',         value: String(budgets.length) },
      { label: 'Total Budgeted',  value: fmt(totalBudgeted) },
      { label: 'Total Spent',     value: fmt(totalSpent) },
      { label: 'Total Remaining', value: fmt(totalBudgeted - totalSpent) },
    ],
    columns: [
      'Project', 'Budget', 'Category', 'Description',
      'Budgeted', 'Committed', 'Actual Spend', 'Remaining', 'Currency',
    ],
    rows,
  };
}

export async function invoiceReport(
  actor: RequestUser,
  filters: ReportFilters,
): Promise<ReportData> {
  const { companyId } = actor;
  const dateRange = buildDateFilter(filters);

  const invoices = await prisma.invoice.findMany({
    where: {
      companyId,
      ...(filters.projectId && { projectId: filters.projectId }),
      ...(filters.siteId    && { siteId: filters.siteId }),
      ...(dateRange          && { issueDate: dateRange }),
    },
    include: {
      project: { select: { name: true } },
    },
    orderBy: { issueDate: 'desc' },
  });

  let totalValue = 0;
  let totalPaid  = 0;
  let overdue    = 0;

  const rows = invoices.map((inv) => {
    const total = Number(inv.totalAmount);
    const paid  = Number(inv.paidAmount);
    totalValue += total;
    totalPaid  += paid;
    if (inv.status === 'overdue') overdue++;
    return [
      inv.invoiceNumber,
      inv.project.name,
      inv.vendorName,
      inv.vendorType,
      inv.status,
      fmtDate(inv.issueDate),
      fmtDate(inv.dueDate),
      fmt(total),
      fmt(paid),
      fmt(total - paid),
      inv.currency,
    ];
  });

  return {
    title:       'Invoice Report',
    subtitle:    'Invoice status and payment summary',
    generatedAt: new Date().toISOString(),
    filters:     buildActiveFilters(filters),
    summary: [
      { label: 'Total Invoices',  value: String(invoices.length) },
      { label: 'Total Value',     value: fmt(totalValue) },
      { label: 'Total Paid',      value: fmt(totalPaid) },
      { label: 'Outstanding',     value: fmt(totalValue - totalPaid) },
      { label: 'Overdue',         value: String(overdue) },
    ],
    columns: [
      'Invoice #', 'Project', 'Vendor', 'Vendor Type', 'Status',
      'Issue Date', 'Due Date', 'Total', 'Paid', 'Outstanding', 'Currency',
    ],
    rows,
  };
}

export async function deliveryReport(
  actor: RequestUser,
  filters: ReportFilters,
): Promise<ReportData> {
  const { companyId } = actor;
  const dateRange = buildDateFilter(filters);

  const deliveries = await prisma.deliveryRecord.findMany({
    where: {
      companyId,
      ...(filters.projectId && { projectId: filters.projectId }),
      ...(filters.siteId    && { siteId: filters.siteId }),
      ...(dateRange          && { deliveryDate: dateRange }),
    },
    include: {
      project: { select: { name: true } },
      site:    { select: { name: true } },
    },
    orderBy: { deliveryDate: 'desc' },
  });

  let rejected = 0;
  let pendingInspection = 0;

  const rows = deliveries.map((d) => {
    if (d.acceptanceStatus === 'rejected') rejected++;
    if (d.inspectionStatus === 'pending')  pendingInspection++;
    return [
      fmtDate(d.deliveryDate),
      d.project.name,
      d.site.name,
      d.supplierName,
      d.itemDescription,
      d.unitOfMeasure,
      String(d.quantityOrdered),
      String(d.quantityDelivered),
      d.conditionOnArrival ?? '',
      d.inspectionStatus,
      d.acceptanceStatus ?? '',
    ];
  });

  return {
    title:       'Delivery Report',
    subtitle:    'Delivery records and inspection status',
    generatedAt: new Date().toISOString(),
    filters:     buildActiveFilters(filters),
    summary: [
      { label: 'Total Deliveries',   value: String(deliveries.length) },
      { label: 'Pending Inspection', value: String(pendingInspection) },
      { label: 'Rejected',           value: String(rejected) },
    ],
    columns: [
      'Date', 'Project', 'Site', 'Supplier', 'Item', 'Unit',
      'Ordered', 'Delivered', 'Condition', 'Inspection', 'Acceptance',
    ],
    rows,
  };
}

export async function contractorReport(
  actor: RequestUser,
  filters: ReportFilters,
): Promise<ReportData> {
  const { companyId } = actor;

  const contractors = await prisma.contractor.findMany({
    where: { companyId, isActive: true },
    include: {
      schedules: {
        where: { companyId, status: 'active' },
        select: { id: true, projectId: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  const rows = contractors.map((c) => [
    c.name,
    c.contactPerson ?? '',
    c.email         ?? '',
    c.phone         ?? '',
    c.tradeSpecialization   ?? '',
    c.registrationNumber    ?? '',
    String(c.schedules.length),
  ]);

  const totalActive = contractors.filter((c) => c.schedules.length > 0).length;

  return {
    title:       'Contractor Report',
    subtitle:    'Active contractors and schedule summary',
    generatedAt: new Date().toISOString(),
    filters:     buildActiveFilters(filters),
    summary: [
      { label: 'Total Contractors',      value: String(contractors.length) },
      { label: 'With Active Schedules',  value: String(totalActive) },
    ],
    columns: [
      'Name', 'Contact Person', 'Email', 'Phone',
      'Trade / Specialization', 'Registration #', 'Active Schedules',
    ],
    rows,
  };
}

export async function consultantReport(
  actor: RequestUser,
  filters: ReportFilters,
): Promise<ReportData> {
  const { companyId } = actor;
  const dateRange = buildDateFilter(filters);

  const instructions = await prisma.consultantInstruction.findMany({
    where: {
      companyId,
      ...(filters.projectId && { projectId: filters.projectId }),
      ...(filters.siteId    && { siteId: filters.siteId }),
      ...(dateRange          && { issuedDate: dateRange }),
    },
    include: {
      project:  { select: { name: true } },
      issuedBy: { select: { firstName: true, lastName: true } },
    },
    orderBy: { issuedDate: 'desc' },
  });

  let open     = 0;
  let critical = 0;
  let resolved = 0;

  const rows = instructions.map((i) => {
    if (['open', 'acknowledged', 'in_progress'].includes(i.status)) open++;
    if (i.priority === 'critical' && !['resolved', 'rejected'].includes(i.status)) critical++;
    if (i.status === 'resolved') resolved++;
    return [
      fmtDate(i.issuedDate),
      i.project.name,
      i.type,
      i.title,
      i.priority,
      i.status,
      `${i.issuedBy.firstName} ${i.issuedBy.lastName}`,
      i.targetActionDate ? fmtDate(i.targetActionDate) : '',
    ];
  });

  return {
    title:       'Consultant Instructions Report',
    subtitle:    'Instructions issued and resolution status',
    generatedAt: new Date().toISOString(),
    filters:     buildActiveFilters(filters),
    summary: [
      { label: 'Total Instructions', value: String(instructions.length) },
      { label: 'Open',               value: String(open) },
      { label: 'Critical',           value: String(critical) },
      { label: 'Resolved',           value: String(resolved) },
    ],
    columns: [
      'Issued Date', 'Project', 'Type', 'Title',
      'Priority', 'Status', 'Issued By', 'Target Date',
    ],
    rows,
  };
}

export async function projectHealthReport(
  actor: RequestUser,
  filters: ReportFilters,
): Promise<ReportData> {
  const { companyId } = actor;

  const projectWhere = {
    companyId,
    ...(filters.projectId && { id: filters.projectId }),
  };

  const projects = await prisma.project.findMany({
    where: projectWhere,
    select: {
      id: true, name: true, code: true, status: true,
      location: true, startDate: true, endDate: true,
    },
  });

  const projectIds = projects.map((p) => p.id);

  // Batch counts per project
  const [invoiceRows, budgetRows, deliveryRows, instructionRows] = await Promise.all([
    prisma.invoice.groupBy({
      by: ['projectId'],
      where: { companyId, projectId: { in: projectIds } },
      _count: { _all: true },
      _sum:   { totalAmount: true, paidAmount: true },
    }),
    prisma.budget.findMany({
      where: { companyId, projectId: { in: projectIds } },
      include: { lineItems: { select: { budgetedAmount: true, actualSpend: true } } },
    }),
    prisma.deliveryRecord.groupBy({
      by: ['projectId'],
      where: { companyId, projectId: { in: projectIds } },
      _count: { _all: true },
    }),
    prisma.consultantInstruction.groupBy({
      by: ['projectId', 'status'],
      where: {
        companyId,
        projectId: { in: projectIds },
        status: { in: ['open', 'acknowledged', 'in_progress'] },
      },
      _count: { _all: true },
    }),
  ]);

  // Index counts by projectId
  const invoiceByProject: Record<string, { count: number; value: number; paid: number }> = {};
  for (const r of invoiceRows) {
    invoiceByProject[r.projectId] = {
      count: r._count._all,
      value: Number(r._sum.totalAmount ?? 0),
      paid:  Number(r._sum.paidAmount  ?? 0),
    };
  }

  const budgetByProject: Record<string, { budgeted: number; spent: number }> = {};
  for (const b of budgetRows) {
    if (!budgetByProject[b.projectId]) budgetByProject[b.projectId] = { budgeted: 0, spent: 0 };
    for (const li of b.lineItems) {
      budgetByProject[b.projectId].budgeted += Number(li.budgetedAmount);
      budgetByProject[b.projectId].spent    += Number(li.actualSpend);
    }
  }

  const deliveryByProject: Record<string, number> = {};
  for (const r of deliveryRows) {
    deliveryByProject[r.projectId] = r._count._all;
  }

  const openInstructionsByProject: Record<string, number> = {};
  for (const r of instructionRows) {
    openInstructionsByProject[r.projectId] =
      (openInstructionsByProject[r.projectId] ?? 0) + r._count._all;
  }

  const rows = projects.map((p) => {
    const inv  = invoiceByProject[p.id]  ?? { count: 0, value: 0, paid: 0 };
    const bud  = budgetByProject[p.id]   ?? { budgeted: 0, spent: 0 };
    const del  = deliveryByProject[p.id] ?? 0;
    const inst = openInstructionsByProject[p.id] ?? 0;
    return [
      p.name,
      p.code ?? '',
      p.status,
      p.location ?? '',
      fmtDate(p.startDate),
      fmtDate(p.endDate),
      String(inv.count),
      fmt(inv.value),
      fmt(bud.budgeted),
      fmt(bud.spent),
      String(del),
      String(inst),
    ];
  });

  const active    = projects.filter((p) => p.status === 'active').length;
  const completed = projects.filter((p) => p.status === 'completed').length;

  return {
    title:       'Project Health Report',
    subtitle:    'Project status, budget and activity overview',
    generatedAt: new Date().toISOString(),
    filters:     buildActiveFilters(filters),
    summary: [
      { label: 'Total Projects',     value: String(projects.length) },
      { label: 'Active',             value: String(active) },
      { label: 'Completed',          value: String(completed) },
    ],
    columns: [
      'Project', 'Code', 'Status', 'Location',
      'Start Date', 'End Date', 'Invoices', 'Invoice Value',
      'Budget', 'Spent', 'Deliveries', 'Open Instructions',
    ],
    rows,
  };
}

// ─── Daily Site Report ────────────────────────────────────────────────────────

export async function dailySiteReport(
  actor: RequestUser,
  filters: ReportFilters,
): Promise<ReportData> {
  const { companyId } = actor;

  if (!filters.projectId) throw new ValidationError('projectId is required for daily-site-report');
  if (!filters.siteId)    throw new ValidationError('siteId is required for daily-site-report');
  if (!filters.startDate) throw new ValidationError('startDate (the report date) is required for daily-site-report');

  const { projectId, siteId, startDate } = filters;

  const dayStart = new Date(startDate + 'T00:00:00.000Z');
  const dayEnd   = new Date(startDate + 'T00:00:00.000Z');
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const [
    attendanceRows,
    labourAgg,
    deliveriesReceivedCount,
    pendingDeliveriesCount,
    materialUsageAgg,
    lowStockCandidates,
    openInstructionsCount,
    criticalInstructionsCount,
    scheduleTasks,
  ] = await Promise.all([
    prisma.attendanceRecord.groupBy({
      by:    ['status'],
      where: { companyId, projectId, siteId, date: { gte: dayStart, lt: dayEnd } },
      _count: { _all: true },
    }),
    prisma.labourEntry.aggregate({
      where: { companyId, projectId, siteId, date: { gte: dayStart, lt: dayEnd } },
      _sum:  { hoursWorked: true },
    }),
    prisma.deliveryRecord.count({
      where: { companyId, projectId, siteId, deliveryDate: { gte: dayStart, lt: dayEnd } },
    }),
    prisma.deliveryRecord.count({
      where: {
        companyId, projectId, siteId,
        OR: [{ inspectionStatus: 'pending' }, { acceptanceStatus: null }],
      },
    }),
    prisma.inventoryTransaction.aggregate({
      where: { companyId, siteId, type: 'usage_out', createdAt: { gte: dayStart, lt: dayEnd } },
      _count: { _all: true },
      _sum:   { quantity: true },
    }),
    prisma.siteInventory.findMany({
      where:  { companyId, siteId, lowStockThreshold: { not: null } },
      select: { materialName: true, currentQuantity: true, unitOfMeasure: true, lowStockThreshold: true },
    }),
    prisma.consultantInstruction.count({
      where: {
        companyId, projectId,
        OR:     [{ siteId }, { siteId: null }],
        status: { in: ['open', 'acknowledged', 'in_progress'] },
      },
    }),
    prisma.consultantInstruction.count({
      where: {
        companyId, projectId,
        OR:       [{ siteId }, { siteId: null }],
        priority: 'critical',
        status:   { notIn: ['resolved', 'rejected'] },
      },
    }),
    prisma.scheduleTask.findMany({
      where:  { companyId, projectId, siteId },
      select: { status: true, plannedEndDate: true, actualProgress: true, plannedProgress: true },
    }),
  ]);

  // ── Attendance breakdown ─────────────────────────────────────────────────
  const byStatus: Record<string, number> = {};
  for (const r of attendanceRows) byStatus[r.status] = r._count._all;
  const workersPresent = byStatus['present']  ?? 0;
  const workersLate    = byStatus['late']     ?? 0;
  const workersHalfDay = byStatus['half_day'] ?? 0;
  const workersAbsent  = byStatus['absent']   ?? 0;
  const workersExcused = byStatus['excused']  ?? 0;
  const workersOnSite  = workersPresent + workersLate + workersHalfDay;

  // ── Labour ───────────────────────────────────────────────────────────────
  const labourHoursToday = Number(labourAgg._sum.hoursWorked ?? 0);

  // ── Materials consumed ───────────────────────────────────────────────────
  const materialsCount    = materialUsageAgg._count._all;
  const materialsQtyTotal = Math.abs(Number(materialUsageAgg._sum.quantity ?? 0));

  // ── Low stock ────────────────────────────────────────────────────────────
  const lowStockCount = lowStockCandidates.filter(
    (i) => Number(i.currentQuantity) <= Number(i.lowStockThreshold!),
  ).length;

  // ── Schedule tasks ───────────────────────────────────────────────────────
  const tasksInProgress  = scheduleTasks.filter((t) => t.status === 'in_progress').length;
  const tasksCompleted   = scheduleTasks.filter((t) => t.status === 'completed').length;
  const tasksDelayed     = scheduleTasks.filter(
    (t) => t.status !== 'completed' && t.plannedEndDate !== null && t.plannedEndDate < dayStart,
  ).length;
  const tasksDueToday    = scheduleTasks.filter(
    (t) => t.status !== 'completed' && t.plannedEndDate !== null &&
           t.plannedEndDate >= dayStart && t.plannedEndDate < dayEnd,
  ).length;
  const tasksOverdue     = tasksDelayed; // same computation — date-based overdue
  const tasksBlocked     = scheduleTasks.filter((t) => t.status === 'blocked').length;
  const tasksBehindPlan  = scheduleTasks.filter(
    (t) => t.actualProgress !== null && t.plannedProgress !== null &&
           Number(t.actualProgress) < Number(t.plannedProgress) - 10,
  ).length;

  const summary = [
    { label: 'Workers On Site',               value: String(workersOnSite) },
    { label: 'Workers Absent',                value: String(workersAbsent) },
    { label: 'Workers Late',                  value: String(workersLate) },
    { label: 'Labour Hours Today',            value: fmt(labourHoursToday, 1) },
    { label: 'Deliveries Received Today',     value: String(deliveriesReceivedCount) },
    { label: 'Deliveries Pending',            value: String(pendingDeliveriesCount) },
    { label: 'Material Usage Transactions',   value: String(materialsCount) },
    { label: 'Low-Stock Items',               value: String(lowStockCount) },
    { label: 'Open Instructions',             value: String(openInstructionsCount) },
    { label: 'Critical Instructions',         value: String(criticalInstructionsCount) },
    { label: 'Tasks In Progress',             value: String(tasksInProgress) },
    { label: 'Tasks Completed',               value: String(tasksCompleted) },
    { label: 'Tasks Delayed',                 value: String(tasksDelayed) },
    { label: 'Tasks Due Today',               value: String(tasksDueToday) },
    { label: 'Tasks Overdue',                 value: String(tasksOverdue) },
    { label: 'Tasks Blocked',                 value: String(tasksBlocked) },
    { label: 'Tasks Behind Plan',             value: String(tasksBehindPlan) },
  ];

  const rows: string[][] = [
    ['Workers On Site',             String(workersOnSite),           `Late: ${workersLate}, Half-day: ${workersHalfDay}`],
    ['Workers Absent',              String(workersAbsent),           workersExcused > 0 ? `Excused: ${workersExcused}` : ''],
    ['Workers Late',                String(workersLate),             ''],
    ['Labour Hours Today',          fmt(labourHoursToday, 1),        ''],
    ['Deliveries Received Today',   String(deliveriesReceivedCount), ''],
    ['Deliveries Pending',          String(pendingDeliveriesCount),  'Pending inspection or acceptance'],
    ['Material Usage Transactions', String(materialsCount),          `Total qty consumed: ${fmt(materialsQtyTotal, 3)}`],
    ['Low-Stock Items',             String(lowStockCount),           lowStockCount > 0 ? 'Check inventory' : ''],
    ['Open Instructions',           String(openInstructionsCount),   ''],
    ['Critical Instructions',       String(criticalInstructionsCount), criticalInstructionsCount > 0 ? 'Requires immediate attention' : ''],
    ['Tasks In Progress',           String(tasksInProgress),         ''],
    ['Tasks Completed',             String(tasksCompleted),          ''],
    ['Tasks Delayed',               String(tasksDelayed),            tasksDelayed > 0 ? 'Past planned end date' : ''],
    ['Tasks Due Today',             String(tasksDueToday),           tasksDueToday > 0 ? 'Due by end of day' : ''],
    ['Tasks Overdue',               String(tasksOverdue),            tasksOverdue > 0 ? 'Past planned end date' : ''],
    ['Tasks Blocked',               String(tasksBlocked),            tasksBlocked > 0 ? 'Investigate blockers' : ''],
    ['Tasks Behind Plan',           String(tasksBehindPlan),         tasksBehindPlan > 0 ? 'Actual progress 10+ points below planned' : ''],
  ];

  return {
    title:       'Daily Site Report',
    subtitle:    `Site activity snapshot for ${startDate}`,
    generatedAt: new Date().toISOString(),
    filters:     { 'Project ID': projectId, 'Site ID': siteId, 'Date': startDate },
    summary,
    columns: ['Metric', 'Value', 'Notes'],
    rows,
  };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

export async function generateReport(
  type: ReportType,
  actor: RequestUser,
  filters: ReportFilters,
): Promise<ReportData> {
  assertReportAccess(type, actor);

  switch (type) {
    case 'labour':         return labourReport(actor, filters);
    case 'budget':         return budgetReport(actor, filters);
    case 'invoices':       return invoiceReport(actor, filters);
    case 'deliveries':     return deliveryReport(actor, filters);
    case 'contractors':    return contractorReport(actor, filters);
    case 'consultants':    return consultantReport(actor, filters);
    case 'project-health':      return projectHealthReport(actor, filters);
    case 'daily-site-report':  return dailySiteReport(actor, filters);
    default:
      throw new NotFoundError('Report type');
  }
}

export function isValidReportType(type: string): type is ReportType {
  return [
    'labour', 'budget', 'invoices', 'deliveries',
    'contractors', 'consultants', 'project-health', 'daily-site-report',
  ].includes(type);
}
