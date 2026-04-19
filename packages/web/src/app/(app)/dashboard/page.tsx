'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { dashboardApi, activityApi, ApiError, ActivityEntry } from '@/lib/api';
import { DashboardStats } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { useSSEEvent } from '@/hooks/useSSEEvent';
import {
  Building2, AlertCircle, ChevronRight, HardHat, Receipt,
  AlertTriangle, CheckCircle2, Clock, TrendingDown, TrendingUp,
  Truck, ClipboardList, DollarSign, BarChart3, Users,
  Bell, ClipboardCheck, PieChart, Ban, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(val: number, currency = 'USD') {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000)     return `$${(val / 1_000).toFixed(0)}K`;
  return val.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
}

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

  const load = useCallback(() => {
    activityApi.list({ limit: 8 })
      .then((r) => setEntries(r.activities))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh on any data-mutation events
  const onMutation = useCallback(() => load(), [load]);
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

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [stats,   setStats]   = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const role            = user?.role ?? '';
  const canViewFinance  = user?.canViewFinance && (role === 'company_admin' || role === 'finance_officer');
  const canManage       = ['company_admin', 'finance_officer', 'project_manager'].includes(role);
  const canSiteOps      = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'].includes(role);
  const canSeeContracts = ['company_admin', 'project_manager', 'contractor', 'consultant', 'site_supervisor'].includes(role);

  const loadStats = useCallback(() => {
    dashboardApi.get()
      .then((r) => setStats(r.stats))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  // ── Auto-refresh dashboard on real-time events ─────────────────────────────
  const onDashboardEvent = useCallback(() => {
    dashboardApi.get()
      .then((r) => setStats(r.stats))
      .catch(() => {});
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
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!stats) return null;

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

  if (canManage) {
    kpis.push({
      label: 'Overdue Invoices',
      value: stats.invoices.overdueCount,
      icon:  <AlertTriangle className="h-5 w-5" />,
      cls:   stats.invoices.overdueCount > 0 ? 'text-red-500' : undefined,
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
        subtitle={user ? `${user.role.replace(/_/g, ' ')} · ${user.email}` : undefined}
      />

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
        {canManage && (
          <Widget title="Invoices" href="/invoices">
            <div className="grid grid-cols-3 gap-2 mb-4">
              <MiniStat label="Total"       value={fmt(stats.invoices.totalValue)}  />
              <MiniStat label="Paid"        value={fmt(stats.invoices.totalPaid)}   valueClass="text-emerald-600" />
              <MiniStat
                label="Outstanding"
                value={fmt(stats.invoices.outstanding)}
                valueClass={stats.invoices.outstanding > 0 ? 'text-amber-600' : undefined}
              />
            </div>

            {(stats.invoices.totalValue > 0) && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Collection rate</span>
                  <span>
                    {stats.invoices.totalValue > 0
                      ? Math.round((stats.invoices.totalPaid / stats.invoices.totalValue) * 100)
                      : 0}%
                  </span>
                </div>
                <ProgressBar
                  value={stats.invoices.totalPaid}
                  max={stats.invoices.totalValue}
                  color="bg-emerald-500"
                />
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 text-xs text-center">
              <div className="rounded-lg bg-muted/30 py-2 px-1">
                <p className="font-semibold text-foreground">{stats.invoices.total}</p>
                <p className="text-muted-foreground">Total</p>
              </div>
              <div className="rounded-lg bg-amber-500/10 py-2 px-1">
                <p className={cn('font-semibold', stats.invoices.pendingApproval > 0 ? 'text-amber-600' : 'text-foreground')}>
                  {stats.invoices.pendingApproval}
                </p>
                <p className="text-muted-foreground">Pending</p>
              </div>
              <div className="rounded-lg bg-red-500/10 py-2 px-1">
                <p className={cn('font-semibold', stats.invoices.overdueCount > 0 ? 'text-red-500' : 'text-foreground')}>
                  {stats.invoices.overdueCount}
                </p>
                <p className="text-muted-foreground">Overdue</p>
              </div>
            </div>

            {stats.invoices.overdueCount > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                {stats.invoices.overdueCount} invoice{stats.invoices.overdueCount !== 1 ? 's' : ''} past due date
              </div>
            )}
          </Widget>
        )}

        {/* Budget widget (canManage) */}
        {canManage && (
          <Widget title="Budget" href="/budget">
            <div className="grid grid-cols-3 gap-2 mb-4">
              <MiniStat label="Budgeted" value={fmt(stats.budget.totalBudgeted)} />
              <MiniStat label="Spent"    value={fmt(stats.budget.totalSpent)}    valueClass={stats.budget.overspendCount > 0 ? 'text-red-500' : 'text-foreground'} />
              <MiniStat
                label="Remaining"
                value={fmt(stats.budget.totalRemaining)}
                valueClass={stats.budget.totalRemaining < 0 ? 'text-red-500' : 'text-emerald-600'}
              />
            </div>

            {stats.budget.totalBudgeted > 0 && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Budget utilisation</span>
                  <span>
                    {Math.round((stats.budget.totalSpent / stats.budget.totalBudgeted) * 100)}%
                  </span>
                </div>
                <ProgressBar
                  value={stats.budget.totalSpent}
                  max={stats.budget.totalBudgeted}
                  color={stats.budget.totalSpent > stats.budget.totalBudgeted ? 'bg-red-500' : 'bg-primary'}
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 text-xs text-center">
              <div className="rounded-lg bg-muted/30 py-2 px-1">
                <p className="font-semibold text-foreground">{stats.budget.budgetsCount}</p>
                <p className="text-muted-foreground">Budgets</p>
              </div>
              <div className="rounded-lg bg-red-500/10 py-2 px-1">
                <p className={cn('font-semibold', stats.budget.overspendCount > 0 ? 'text-red-500' : 'text-foreground')}>
                  {stats.budget.overspendCount}
                </p>
                <p className="text-muted-foreground">Overspent</p>
              </div>
            </div>

            {stats.budget.overspendCount > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-600">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                {stats.budget.overspendCount} budget{stats.budget.overspendCount !== 1 ? 's have' : ' has'} overspent line items
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
                <div className="grid grid-cols-2 gap-2 text-xs text-center">
                  <div className="rounded-lg bg-muted/30 py-2">
                    <p className="font-semibold text-foreground">{stats.labour.thisWeekHours.toFixed(1)}h</p>
                    <p className="text-muted-foreground">This Week</p>
                  </div>
                  <div className="rounded-lg bg-muted/30 py-2">
                    <p className="font-semibold text-foreground">{fmt(stats.labour.thisMonthCost)}</p>
                    <p className="text-muted-foreground">Month Cost</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link href="/labour" className="text-xs text-primary hover:underline text-center">Labour entries →</Link>
              <Link href="/attendance" className="text-xs text-primary hover:underline text-center">Attendance →</Link>
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
          <Widget title="Deliveries" href="/projects">
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
              <MiniStat label="Total Inflows"    value={fmt(stats.finance.totalInflows)}     valueClass="text-emerald-600" />
              <MiniStat label="This Month"       value={fmt(stats.finance.inflowsThisMonth)} />
              <MiniStat
                label="Net Position"
                value={fmt(Math.abs(stats.finance.netPosition))}
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
