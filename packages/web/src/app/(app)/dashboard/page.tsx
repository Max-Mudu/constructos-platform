'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import { dashboardApi, activityApi, ApiError, ActivityEntry } from '@/lib/api';
import { DashboardStats } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { LoadErrorAlert, loadErrorMessage } from '@/components/ui/LoadErrorAlert';
import { useSSEEvent } from '@/hooks/useSSEEvent';
import {
  Building2, AlertCircle, ChevronRight, HardHat, Receipt,
  AlertTriangle, CheckCircle2, Clock, TrendingDown, TrendingUp,
  Truck, ClipboardList, DollarSign, BarChart3, Users,
  Bell, ClipboardCheck, PieChart, Ban, Activity,
} from 'lucide-react';
import { cn, formatMoney } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Dashboard KPI cards are dense, so money is shown compactly ("KES 2.5M").
// Intl derives both the compact suffix and the symbol; the currency itself comes
// from the authenticated company at each call site, never from a default here.
const MONEY_COMPACT: Intl.NumberFormatOptions = { notation: 'compact', maximumFractionDigits: 1 };

function fmtNum(val: number) {
  return val.toLocaleString();
}

function projectStatusVariant(s: string): 'active' | 'pending' | 'secondary' | 'inactive' {
  if (s === 'active')    return 'active';
  if (s === 'on_hold')   return 'pending';
  if (s === 'completed') return 'secondary';
  return 'inactive';
}

// ─── Widget card ──────────────────────────────────────────────────────────────

function Widget({
  title,
  href,
  children,
  className,
}: {
  title:     string;
  href?:     string;
  children:  React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-card', className)}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {href && (
          <Link href={href} className="text-xs text-primary hover:underline underline-offset-4">
            View all
          </Link>
        )}
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

// ─── Mini KPI row ─────────────────────────────────────────────────────────────

function MiniStat({ label, value, valueClass }: { label: string; value: string | number; valueClass?: string }) {
  return (
    <div className="text-center">
      <p className={cn('text-lg font-bold', valueClass ?? 'text-foreground')}>{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

// The API nulls financial fields for users without financial read access.
type NonNullFields<T> = { [K in keyof T]: NonNullable<T[K]> };
function allPresent<T extends object>(o: T | null | undefined): o is T & NonNullFields<T> {
  return !!o && Object.values(o).every((v) => v !== null && v !== undefined);
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ value, max, color = 'bg-primary' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Attendance ring ──────────────────────────────────────────────────────────

function AttendanceRing({ rate }: { rate: number }) {
  const color = rate >= 90 ? 'text-emerald-500' : rate >= 70 ? 'text-amber-500' : 'text-red-500';
  return (
    <div className="flex flex-col items-center justify-center h-20 w-20">
      <span className={cn('text-2xl font-bold', color)}>{rate}%</span>
      <span className="text-xs text-muted-foreground">Attendance</span>
    </div>
  );
}

// ─── Activity feed ────────────────────────────────────────────────────────────

function ActivityFeed() {
  const [entries,  setEntries]  = useState<ActivityEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const activityDebounceRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    activityApi.list({ limit: 8 })
      .then((r) => { setEntries(r.activities); setError(''); })
      .catch((e) => setError(loadErrorMessage(e, 'recent activity')))
      .finally(() => setLoading(false));
  }, []);

  const retry = useCallback(() => { setLoading(true); setError(''); load(); }, [load]);

  useEffect(() => { load(); }, [load]);

  // Debounce SSE-triggered refreshes so rapid-fire events (e.g. bulk labour
  // import) collapse into a single API call after a 1-second quiet period.
  useEffect(() => () => {
    if (activityDebounceRef.current) clearTimeout(activityDebounceRef.current);
  }, []);

  const onMutation = useCallback(() => {
    if (activityDebounceRef.current) clearTimeout(activityDebounceRef.current);
    activityDebounceRef.current = setTimeout(() => { load(); }, 1_000);
  }, [load]);
  useSSEEvent('invoice_updated',      onMutation);
  useSSEEvent('delivery_created',     onMutation);
  useSSEEvent('labour_created',       onMutation);
  useSSEEvent('instruction_updated',  onMutation);

  function label(action: string, entityType: string) {
    const e = entityType.replace(/_/g, ' ');
    if (action === 'create') return `Created ${e}`;
    if (action === 'update') return `Updated ${e}`;
    if (action === 'delete') return `Deleted ${e}`;
    return `${action} ${e}`;
  }

  function relTime(iso: string) {
    const diff  = Date.now() - new Date(iso).getTime();
    const mins  = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days  = Math.floor(diff / 86_400_000);
    if (mins  <  1) return 'just now';
    if (mins  < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days  <  7) return `${days}d ago`;
    return new Date(iso).toLocaleDateString();
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {[1,2,3,4].map((i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
      </div>
    );
  }

  if (error && entries.length === 0) {
    return <LoadErrorAlert message={error} onRetry={retry} />;
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center py-6 gap-2 text-muted-foreground">
        <Activity className="h-8 w-8 opacity-30" />
        <p className="text-sm">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {label(entry.action, entry.entityType)}
            </p>
            <p className="text-xs text-muted-foreground truncate">{entry.userEmail}</p>
          </div>
          <span className="text-xs text-muted-foreground/60 shrink-0 ml-3">
            {relTime(entry.createdAt)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Operational helpers ──────────────────────────────────────────────────────

function operationalHref(
  segment: string,
  u: { defaultProjectId: string | null; defaultSiteId: string | null } | null,
): string {
  // These have hub pages that open the default site only if it is still
  // reachable (and otherwise offer a site picker) — never a stale 403/404.
  if (segment === 'attendance' || segment === 'labour' || segment === 'targets') {
    return `/${segment}`;
  }
  if (u?.defaultProjectId && u?.defaultSiteId) {
    return `/projects/${u.defaultProjectId}/sites/${u.defaultSiteId}/${segment}`;
  }
  return '/projects';
}

function AlertChip({
  count, label, severity, href,
}: {
  count:    number | string;
  label:    string;
  severity: 'red' | 'amber';
  href:     string;
}) {
  const cls = severity === 'red'
    ? 'bg-red-950/40 border-red-800/50 text-red-400 hover:bg-red-950/70'
    : 'bg-amber-950/40 border-amber-800/50 text-amber-400 hover:bg-amber-950/70';
  return (
    <Link
      href={href}
      className={cn('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors', cls)}
    >
      <span className="font-bold">{count}</span>
      <span className="font-medium">{label}</span>
    </Link>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [stats,   setStats]   = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const statsDebounceRef      = useRef<ReturnType<typeof setTimeout> | null>(null);

  const role            = user?.role ?? '';
  const canViewFinance  = user?.canViewFinance && (role === 'company_admin' || role === 'finance_officer');
  const canManage       = ['company_admin', 'finance_officer', 'project_manager'].includes(role);
  const canSiteOps      = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'].includes(role);
  const canSeeContracts = ['company_admin', 'project_manager', 'contractor', 'consultant', 'site_supervisor'].includes(role);

  const loadStats = useCallback(() => {
    setLoading(true);
    setError('');
    dashboardApi.get()
      .then((r) => setStats(r.stats))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  // Clear any pending debounce timer on unmount
  useEffect(() => () => {
    if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
  }, []);

  // ── Auto-refresh dashboard on real-time events (debounced) ────────────────
  // Coalesces rapid-fire events (e.g. bulk delivery import) into one API call
  // after a 1-second quiet period instead of firing once per event.
  const onDashboardEvent = useCallback(() => {
    if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
    statsDebounceRef.current = setTimeout(() => {
      dashboardApi.get()
        .then((r) => setStats(r.stats))
        // Background refresh after a live event: the figures already on screen
        // stay valid, and the next event or a reload tries again.
        .catch(() => {});
    }, 1_000);
  }, []);

  useSSEEvent('invoice_updated',     onDashboardEvent);
  useSSEEvent('delivery_created',    onDashboardEvent);
  useSSEEvent('labour_created',      onDashboardEvent);
  useSSEEvent('instruction_updated', onDashboardEvent);

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-6">
        <Skeleton className="h-14 w-80 rounded-xl" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8">
        <LoadErrorAlert message={error} onRetry={loadStats} />
      </div>
    );
  }

  if (!stats || !user) return null;

  // ── Operational alert data ─────────────────────────────────────────────────
  const scheduleAlerts = stats.schedule;
  const hasScheduleAlerts = !!(scheduleAlerts && (
    scheduleAlerts.overdueTasks    > 0 ||
    scheduleAlerts.blockedTasks    > 0 ||
    scheduleAlerts.dueTodayTasks   > 0 ||
    scheduleAlerts.delayedTasks    > 0 ||
    scheduleAlerts.behindPlanTasks > 0
  ));

  const labourAlerts = stats.labourAlerts;
  const hasLabourAlerts = !!(labourAlerts && (
    labourAlerts.zeroWorkforceToday       ||
    labourAlerts.attendanceRateToday < 70 ||
    labourAlerts.absentToday         > 0  ||
    labourAlerts.lateToday           > 0
  ));

  const procAlerts = stats.procurementAlerts;
  const hasProcAlerts = !!(procAlerts && (
    procAlerts.pendingDeliveriesCount  > 0 ||
    procAlerts.rejectedLast30dCount    > 0 ||
    procAlerts.damagedLast30dCount     > 0 ||
    procAlerts.lowStockNoDeliveryCount > 0
  ));

  const lowStockAlerts = stats.lowStockInventory;
  const hasLowStock    = !!(lowStockAlerts && lowStockAlerts.count > 0);

  const hasOperationalAlerts = hasScheduleAlerts || hasLabourAlerts || hasProcAlerts || hasLowStock;

  // ── Financial blocks (null when the API withholds them) ───────────────────
  const invoiceStats  = allPresent(stats.invoices) ? stats.invoices : null;
  const budgetStats   = allPresent(stats.budget)   ? stats.budget   : null;
  const thisMonthCost = stats.labour.thisMonthCost;

  // ── Top KPI strip (role-based selection) ──────────────────────────────────
  type KPI = { label: string; value: string | number; icon: React.ReactNode; cls?: string; href?: string };
  const kpis: KPI[] = [];

  kpis.push({
    label: 'Active Projects',
    value: stats.projects.active,
    icon:  <Building2 className="h-5 w-5" />,
    href:  '/projects',
  });

  if (canSiteOps) {
    kpis.push({
      label: 'Active Workers',
      value: stats.workers.active,
      icon:  <HardHat className="h-5 w-5" />,
      href:  '/workers',
    });
    kpis.push({
      label: 'Today Attendance',
      value: `${stats.attendance.todayRate}%`,
      icon:  <ClipboardCheck className="h-5 w-5" />,
      cls:   stats.attendance.todayRate < 70 ? 'text-red-500' : stats.attendance.todayRate < 90 ? 'text-amber-500' : 'text-emerald-500',
      href:  '/attendance',
    });
  }

  if (canManage && invoiceStats) {
    kpis.push({
      label: 'Overdue Invoices',
      value: invoiceStats.overdueCount,
      icon:  <AlertTriangle className="h-5 w-5" />,
      cls:   invoiceStats.overdueCount > 0 ? 'text-red-500' : undefined,
      href:  '/invoices',
    });
  }

  if (canSeeContracts) {
    kpis.push({
      label: 'Open Instructions',
      value: stats.instructions.open,
      icon:  <ClipboardList className="h-5 w-5" />,
      cls:   stats.instructions.critical > 0 ? 'text-amber-500' : undefined,
      href:  '/consultants/instructions',
    });
  }

  kpis.push({
    label: 'Unread Notifications',
    value: stats.notifications.unread,
    icon:  <Bell className="h-5 w-5" />,
    cls:   stats.notifications.unread > 0 ? 'text-primary' : undefined,
    href:  '/notifications',
  });

  const topKpis = kpis.slice(0, 4);

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title={`Welcome back, ${user?.firstName ?? ''}!`}
        subtitle={user ? user.role.replace(/_/g, ' ') : undefined}
      />

      {/* ── Operational alert strip ─────────────────────────────────────── */}
      {hasOperationalAlerts && (
        <div className="rounded-xl border border-border bg-card px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Needs Attention
          </p>
          <div className="flex flex-wrap gap-2">
            {/* Priority 1 — Schedule */}
            {scheduleAlerts && scheduleAlerts.overdueTasks > 0 && (
              <AlertChip count={scheduleAlerts.overdueTasks}    label="Overdue Tasks" severity="red"   href={operationalHref('schedules', user)} />
            )}
            {scheduleAlerts && scheduleAlerts.blockedTasks > 0 && (
              <AlertChip count={scheduleAlerts.blockedTasks}    label="Blocked"       severity="red"   href={operationalHref('schedules', user)} />
            )}
            {scheduleAlerts && scheduleAlerts.dueTodayTasks > 0 && (
              <AlertChip count={scheduleAlerts.dueTodayTasks}   label="Due Today"     severity="amber" href={operationalHref('schedules', user)} />
            )}
            {scheduleAlerts && scheduleAlerts.delayedTasks > 0 && (
              <AlertChip count={scheduleAlerts.delayedTasks}    label="Delayed"       severity="amber" href={operationalHref('schedules', user)} />
            )}
            {scheduleAlerts && scheduleAlerts.behindPlanTasks > 0 && (
              <AlertChip count={scheduleAlerts.behindPlanTasks} label="Behind Plan"   severity="amber" href={operationalHref('schedules', user)} />
            )}
            {/* Priority 2 — Labour */}
            {labourAlerts?.zeroWorkforceToday && (
              <AlertChip count="!" label="No Workforce" severity="red" href={operationalHref('attendance', user)} />
            )}
            {labourAlerts && !labourAlerts.zeroWorkforceToday && labourAlerts.attendanceRateToday < 70 && (
              <AlertChip count={`${labourAlerts.attendanceRateToday}%`} label="Attendance" severity="red" href={operationalHref('attendance', user)} />
            )}
            {labourAlerts && labourAlerts.absentToday > 0 && (
              <AlertChip count={labourAlerts.absentToday} label="Absent" severity="amber" href={operationalHref('attendance', user)} />
            )}
            {labourAlerts && labourAlerts.lateToday > 0 && (
              <AlertChip count={labourAlerts.lateToday} label="Late" severity="amber" href={operationalHref('attendance', user)} />
            )}
            {/* Priority 3 — Procurement */}
            {procAlerts && procAlerts.rejectedLast30dCount > 0 && (
              <AlertChip count={procAlerts.rejectedLast30dCount}    label="Rejected Deliveries" severity="red"   href={operationalHref('deliveries', user)} />
            )}
            {procAlerts && procAlerts.damagedLast30dCount > 0 && (
              <AlertChip count={procAlerts.damagedLast30dCount}     label="Damaged Deliveries"  severity="red"   href={operationalHref('deliveries', user)} />
            )}
            {procAlerts && procAlerts.lowStockNoDeliveryCount > 0 && (
              <AlertChip count={procAlerts.lowStockNoDeliveryCount} label="No Reorder"           severity="red"   href={operationalHref('inventory', user)} />
            )}
            {procAlerts && procAlerts.pendingDeliveriesCount > 0 && (
              <AlertChip count={procAlerts.pendingDeliveriesCount}  label="Pending Inspection"   severity="amber" href={operationalHref('deliveries', user)} />
            )}
            {/* Priority 4 — Low stock */}
            {lowStockAlerts && lowStockAlerts.count > 0 && (
              <AlertChip count={lowStockAlerts.count} label="Low Stock Items" severity="amber" href={operationalHref('inventory', user)} />
            )}
          </div>
        </div>
      )}

      {/* ── Top KPI strip ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {topKpis.map((kpi, i) => (
          <Link key={i} href={kpi.href ?? '#'} className="block">
            <StatCard
              label={kpi.label}
              value={kpi.value}
              icon={kpi.icon}
              valueClassName={kpi.cls}
            />
          </Link>
        ))}
      </div>

      {/* ── Main grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">

        {/* Projects widget */}
        <Widget title="Projects" href="/projects">
          <div className="grid grid-cols-4 gap-2 mb-4">
            <MiniStat label="Active"    value={stats.projects.active}    valueClass="text-emerald-600" />
            <MiniStat label="Planning"  value={stats.projects.planning}  />
            <MiniStat label="On Hold"   value={stats.projects.onHold}    valueClass={stats.projects.onHold > 0 ? 'text-amber-500' : undefined} />
            <MiniStat label="Completed" value={stats.projects.completed} valueClass="text-muted-foreground" />
          </div>
          {stats.projects.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-3">No projects yet.</p>
          ) : (
            <div className="space-y-2">
              {stats.projects.recent.map((p) => (
                <Link key={p.id} href={`/projects/${p.id}`}>
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2 hover:bg-accent transition-colors cursor-pointer">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                      {p.location && <p className="text-xs text-muted-foreground truncate">{p.location}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      <Badge variant={projectStatusVariant(p.status)} className="text-xs">
                        {p.status.replace(/_/g, ' ')}
                      </Badge>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Widget>

        {/* Invoice widget (canManage) */}
        {canManage && invoiceStats && (
          <Widget title="Invoices" href="/invoices">
            <div className="grid grid-cols-3 gap-2 mb-4">
              <MiniStat label="Total"       value={formatMoney(invoiceStats.totalValue, user.currency, MONEY_COMPACT)}  />
              <MiniStat label="Paid"        value={formatMoney(invoiceStats.totalPaid, user.currency, MONEY_COMPACT)}   valueClass="text-emerald-600" />
              <MiniStat
                label="Outstanding"
                value={formatMoney(invoiceStats.outstanding, user.currency, MONEY_COMPACT)}
                valueClass={invoiceStats.outstanding > 0 ? 'text-amber-600' : undefined}
              />
            </div>

            {(invoiceStats.totalValue > 0) && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Collection rate</span>
                  <span>
                    {invoiceStats.totalValue > 0
                      ? Math.round((invoiceStats.totalPaid / invoiceStats.totalValue) * 100)
                      : 0}%
                  </span>
                </div>
                <ProgressBar
                  value={invoiceStats.totalPaid}
                  max={invoiceStats.totalValue}
                  color="bg-emerald-500"
                />
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 text-xs text-center">
              <div className="rounded-lg bg-muted/30 py-2 px-1">
                <p className="font-semibold text-foreground">{invoiceStats.total}</p>
                <p className="text-muted-foreground">Total</p>
              </div>
              <div className="rounded-lg bg-amber-500/10 py-2 px-1">
                <p className={cn('font-semibold', invoiceStats.pendingApproval > 0 ? 'text-amber-600' : 'text-foreground')}>
                  {invoiceStats.pendingApproval}
                </p>
                <p className="text-muted-foreground">Pending</p>
              </div>
              <div className="rounded-lg bg-red-500/10 py-2 px-1">
                <p className={cn('font-semibold', invoiceStats.overdueCount > 0 ? 'text-red-500' : 'text-foreground')}>
                  {invoiceStats.overdueCount}
                </p>
                <p className="text-muted-foreground">Overdue</p>
              </div>
            </div>

            {invoiceStats.overdueCount > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                {invoiceStats.overdueCount} invoice{invoiceStats.overdueCount !== 1 ? 's' : ''} past due date
              </div>
            )}
          </Widget>
        )}

        {/* Budget widget (canManage) */}
        {canManage && budgetStats && (
          <Widget title="Budget" href="/budget">
            <div className="grid grid-cols-3 gap-2 mb-4">
              <MiniStat label="Budgeted" value={formatMoney(budgetStats.totalBudgeted, user.currency, MONEY_COMPACT)} />
              <MiniStat label="Spent"    value={formatMoney(budgetStats.totalSpent, user.currency, MONEY_COMPACT)}    valueClass={budgetStats.overspendCount > 0 ? 'text-red-500' : 'text-foreground'} />
              <MiniStat
                label="Remaining"
                value={formatMoney(budgetStats.totalRemaining, user.currency, MONEY_COMPACT)}
                valueClass={budgetStats.totalRemaining < 0 ? 'text-red-500' : 'text-emerald-600'}
              />
            </div>

            {budgetStats.totalBudgeted > 0 && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Budget utilisation</span>
                  <span>
                    {Math.round((budgetStats.totalSpent / budgetStats.totalBudgeted) * 100)}%
                  </span>
                </div>
                <ProgressBar
                  value={budgetStats.totalSpent}
                  max={budgetStats.totalBudgeted}
                  color={budgetStats.totalSpent > budgetStats.totalBudgeted ? 'bg-red-500' : 'bg-primary'}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs text-center">
              <div className="rounded-lg bg-muted/30 py-2 px-1">
                <p className="font-semibold text-foreground">{budgetStats.budgetsCount}</p>
                <p className="text-muted-foreground">Budgets</p>
              </div>
              <div className="rounded-lg bg-red-500/10 py-2 px-1">
                <p className={cn('font-semibold', budgetStats.overspendCount > 0 ? 'text-red-500' : 'text-foreground')}>
                  {budgetStats.overspendCount}
                </p>
                <p className="text-muted-foreground">Overspent</p>
              </div>
            </div>

            {budgetStats.overspendCount > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {budgetStats.overspendCount} budget{budgetStats.overspendCount !== 1 ? 's have' : ' has'} overspent line items
              </div>
            )}
          </Widget>
        )}

        {/* Labour & Attendance widget (site ops) */}
        {canSiteOps && (
          <Widget title="Labour & Attendance">
            <div className="flex items-center gap-6">
              <AttendanceRing rate={stats.attendance.todayRate} />
              <div className="flex-1 space-y-3">
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Today attendance</span>
                    <span>{stats.attendance.todayPresent}/{stats.attendance.todayTotal}</span>
                  </div>
                  <ProgressBar
                    value={stats.attendance.todayPresent}
                    max={Math.max(stats.attendance.todayTotal, 1)}
                    color={stats.attendance.todayRate >= 90 ? 'bg-emerald-500' : stats.attendance.todayRate >= 70 ? 'bg-amber-500' : 'bg-red-500'}
                  />
                </div>
                <div className={cn('grid gap-2 text-xs text-center', thisMonthCost !== null ? 'grid-cols-2' : 'grid-cols-1')}>
                  <div className="rounded-lg bg-muted/30 py-2">
                    <p className="font-semibold text-foreground">{stats.labour.thisWeekHours.toFixed(1)}h</p>
                    <p className="text-muted-foreground">This Week</p>
                  </div>
                  {/* Labour cost is withheld (null) by the API for non-finance users */}
                  {thisMonthCost !== null && (
                    <div className="rounded-lg bg-muted/30 py-2">
                      <p className="font-semibold text-foreground">{formatMoney(thisMonthCost, user.currency, MONEY_COMPACT)}</p>
                      <p className="text-muted-foreground">Month Cost</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link href={operationalHref('labour', user)} className="text-xs text-primary hover:underline text-center">Labour entries →</Link>
              <Link href={operationalHref('attendance', user)} className="text-xs text-primary hover:underline text-center">Attendance →</Link>
            </div>
          </Widget>
        )}

        {/* Workers & Contractors widget (canSiteOps or canManage) */}
        {(canSiteOps || canManage) && (
          <Widget title="People">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="rounded-xl border border-border p-3 text-center">
                <HardHat className="h-6 w-6 text-primary mx-auto mb-1" />
                <p className="text-xl font-bold text-foreground">{stats.workers.active}</p>
                <p className="text-xs text-muted-foreground">Active Workers</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">{stats.workers.total} total</p>
              </div>
              <div className="rounded-xl border border-border p-3 text-center">
                <Truck className="h-6 w-6 text-primary mx-auto mb-1" />
                <p className="text-xl font-bold text-foreground">{stats.contractors.total}</p>
                <p className="text-xs text-muted-foreground">Contractors</p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">{stats.contractors.activeSchedules} active schedules</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Link href="/workers" className="text-xs text-primary hover:underline text-center">Manage workers →</Link>
              <Link href="/contractors" className="text-xs text-primary hover:underline text-center">Manage contractors →</Link>
            </div>
          </Widget>
        )}

        {/* Deliveries widget (canSiteOps) */}
        {canSiteOps && (
          <Widget title="Deliveries" href={operationalHref('deliveries', user)}>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <MiniStat label="This Month" value={stats.deliveries.thisMonthCount} />
              <MiniStat label="Total"      value={stats.deliveries.totalCount}     />
              <MiniStat
                label="Pending Inspection"
                value={stats.deliveries.pendingInspectionCount}
                valueClass={stats.deliveries.pendingInspectionCount > 0 ? 'text-amber-500' : undefined}
              />
            </div>
            {stats.deliveries.pendingInspectionCount > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-600">
                <Clock className="h-3.5 w-3.5 flex-shrink-0" />
                {stats.deliveries.pendingInspectionCount} deliver{stats.deliveries.pendingInspectionCount !== 1 ? 'ies' : 'y'} awaiting inspection
              </div>
            )}
          </Widget>
        )}

        {/* Instructions widget (canSeeContracts) */}
        {canSeeContracts && (
          <Widget title="Instructions" href="/consultants/instructions">
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div className="rounded-xl border border-border p-3 text-center">
                <ClipboardList className="h-6 w-6 text-primary mx-auto mb-1" />
                <p className="text-xl font-bold text-foreground">{stats.instructions.open}</p>
                <p className="text-xs text-muted-foreground">Open</p>
              </div>
              <div className="rounded-xl border border-border p-3 text-center">
                <AlertTriangle className={cn('h-6 w-6 mx-auto mb-1', stats.instructions.critical > 0 ? 'text-red-500' : 'text-muted-foreground')} />
                <p className={cn('text-xl font-bold', stats.instructions.critical > 0 ? 'text-red-500' : 'text-foreground')}>
                  {stats.instructions.critical}
                </p>
                <p className="text-xs text-muted-foreground">Critical</p>
              </div>
            </div>
            {stats.instructions.critical > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                {stats.instructions.critical} critical instruction{stats.instructions.critical !== 1 ? 's' : ''} need attention
              </div>
            )}
          </Widget>
        )}

        {/* Finance widget (admin + canViewFinance) */}
        {canViewFinance && stats.finance && (
          <Widget title="Client Finance" href="/finance">
            <div className="grid grid-cols-3 gap-2 mb-4">
              <MiniStat label="Total Inflows"    value={formatMoney(stats.finance.totalInflows, user.currency, MONEY_COMPACT)}     valueClass="text-emerald-600" />
              <MiniStat label="This Month"       value={formatMoney(stats.finance.inflowsThisMonth, user.currency, MONEY_COMPACT)} />
              <MiniStat
                label="Net Position"
                value={formatMoney(Math.abs(stats.finance.netPosition), user.currency, MONEY_COMPACT)}
                valueClass={stats.finance.netPosition >= 0 ? 'text-emerald-600' : 'text-red-500'}
              />
            </div>
            <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <DollarSign className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" />
              Net = total inflows minus outstanding invoice balance
            </div>
          </Widget>
        )}

        {/* Notifications widget */}
        <Widget title="Notifications" href="/notifications">
          {stats.notifications.unread === 0 ? (
            <div className="flex flex-col items-center py-4 gap-2">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <p className="text-sm text-muted-foreground">All caught up! No unread notifications.</p>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
                <Bell className="h-7 w-7 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{stats.notifications.unread}</p>
                <p className="text-sm text-muted-foreground">
                  unread notification{stats.notifications.unread !== 1 ? 's' : ''}
                </p>
                <Link href="/notifications" className="text-xs text-primary hover:underline mt-1 block">
                  View notifications →
                </Link>
              </div>
            </div>
          )}
        </Widget>

        {/* Activity feed (managers only) */}
        {canManage && (
          <Widget title="Recent Activity" className="lg:col-span-2">
            <ActivityFeed />
          </Widget>
        )}

      </div>
    </div>
  );
}
