'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { scheduleApi, ApiError } from '@/lib/api';
import { ScheduleTask, WorkPackage, ScheduleTaskStatus } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { StickyActionsRow } from '@/components/ui/StickyActionsRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Separator } from '@/components/ui/Separator';
import { StatCard } from '@/components/ui/StatCard';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  ClipboardList, Plus, AlertCircle, ChevronRight,
  CheckCircle2, Clock, AlertTriangle, Ban, Circle,
} from 'lucide-react';

const STATUS_CONFIG: Record<ScheduleTaskStatus, { label: string; variant: 'active' | 'pending' | 'secondary' | 'inactive' | 'destructive'; icon: React.ReactNode }> = {
  not_started: { label: 'Not Started', variant: 'secondary',   icon: <Circle         className="h-3.5 w-3.5" /> },
  in_progress: { label: 'In Progress', variant: 'active',      icon: <Clock          className="h-3.5 w-3.5" /> },
  delayed:     { label: 'Delayed',     variant: 'pending',     icon: <AlertTriangle  className="h-3.5 w-3.5" /> },
  blocked:     { label: 'Blocked',     variant: 'destructive', icon: <Ban            className="h-3.5 w-3.5" /> },
  completed:   { label: 'Completed',   variant: 'secondary',   icon: <CheckCircle2   className="h-3.5 w-3.5" /> },
};

// ─── Risk helpers ──────────────────────────────────────────────────────────────

type TaskRisk = 'overdue' | 'blocked' | 'delayed' | 'behindPlan' | 'completed' | null;

function getTaskRisk(task: ScheduleTask, today: string): TaskRisk {
  if (task.status === 'completed') return 'completed';
  const end = task.plannedEndDate ? task.plannedEndDate.split('T')[0]! : null;
  if (end && end < today) return 'overdue';
  if (task.status === 'blocked') return 'blocked';
  if (task.status === 'delayed') return 'delayed';
  if (
    task.actualProgress !== null && task.plannedProgress !== null &&
    parseFloat(task.actualProgress) < parseFloat(task.plannedProgress) - 10
  ) return 'behindPlan';
  return null;
}

const RISK_ROW_CLASSES: Record<string, string> = {
  overdue:    'border-l-2 !border-l-red-500 bg-red-950/20',
  blocked:    'border-l-2 !border-l-red-500 bg-red-950/20',
  delayed:    'border-l-2 !border-l-amber-500 bg-amber-950/20',
  behindPlan: 'border-l-2 !border-l-amber-500 bg-amber-950/20',
  completed:  'opacity-60',
};

function RiskChip({ label, count, color }: { label: string; count: number; color: 'red' | 'amber' }) {
  const cls = color === 'red'
    ? 'bg-red-950/40 border border-red-500/40 text-red-400'
    : 'bg-amber-950/40 border border-amber-500/40 text-amber-400';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold ${cls}`}>
      <span className="text-sm font-extrabold">{count}</span>
      {label}
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-border">
      <div
        className="h-1.5 rounded-full bg-primary transition-all"
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  );
}

export default function SchedulesPage() {
  const { projectId, siteId }     = useParams<{ projectId: string; siteId: string }>()!;
  const { user }                  = useAuthStore();
  const [tasks, setTasks]         = useState<ScheduleTask[]>([]);
  const [packages, setPackages]   = useState<WorkPackage[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [packageFilter, setPackageFilter] = useState('');

  const canManage = user?.role === 'company_admin' || user?.role === 'project_manager' || user?.role === 'contractor';

  const load = useCallback(() => {
    if (!projectId || !siteId) return;
    setLoading(true);
    Promise.all([
      scheduleApi.listTasks(projectId, siteId),
      scheduleApi.listPackages(projectId, siteId),
    ])
      .then(([t, p]) => { setTasks(t.tasks); setPackages(p.packages); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load schedule'))
      .finally(() => setLoading(false));
  }, [projectId, siteId]);

  useEffect(() => { load(); }, [load]);

  const filteredTasks = packageFilter
    ? tasks.filter((t) => t.workPackageId === packageFilter)
    : tasks;

  // Stats
  const total       = tasks.length;
  const completed   = tasks.filter((t) => t.status === 'completed').length;
  const inProgress  = tasks.filter((t) => t.status === 'in_progress').length;
  const delayed     = tasks.filter((t) => t.status === 'delayed' || t.status === 'blocked').length;
  const withProgress = tasks.filter((t) => t.actualProgress !== null);
  const avgProgress = withProgress.length > 0
    ? Math.round(withProgress.reduce((s, t) => s + parseFloat(t.actualProgress ?? '0'), 0) / withProgress.length)
    : 0;

  const today = useMemo(() => new Date().toISOString().split('T')[0]!, []);

  const riskSummary = useMemo(() => ({
    overdue:    tasks.filter((t) => t.status !== 'completed' && t.plannedEndDate && t.plannedEndDate.split('T')[0]! < today).length,
    dueToday:   tasks.filter((t) => t.status !== 'completed' && t.plannedEndDate && t.plannedEndDate.split('T')[0]! === today).length,
    blocked:    tasks.filter((t) => t.status === 'blocked').length,
    delayed:    tasks.filter((t) => t.status === 'delayed').length,
    behindPlan: tasks.filter((t) => t.actualProgress !== null && t.plannedProgress !== null && parseFloat(t.actualProgress) < parseFloat(t.plannedProgress) - 10).length,
  }), [tasks, today]);

  const hasRisk = riskSummary.overdue > 0 || riskSummary.dueToday > 0 || riskSummary.blocked > 0 || riskSummary.delayed > 0 || riskSummary.behindPlan > 0;

  return (
    <div className="animate-fade-in">
      <StickyActionsRow title="Schedule" />

      <div className="px-6 py-8 space-y-8">
        <div className="space-y-4">
          <Breadcrumb items={[
            { label: 'Projects', href: '/projects' },
            { label: 'Project', href: `/projects/${projectId}` },
            { label: 'Site', href: `/projects/${projectId}/sites/${siteId}` },
            { label: 'Schedule' },
          ]} />
          <PageHeader
            title="Contractor Schedule"
            subtitle="Work packages, tasks, and progress tracking"
            action={
              canManage ? (
                <Link href={`/projects/${projectId}/sites/${siteId}/schedules/new`}>
                  <Button><Plus className="h-4 w-4" /> Add Task</Button>
                </Link>
              ) : undefined
            }
          />
        </div>

        {/* Summary Stats */}
        {!loading && total > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Total Tasks" value={total} />
            <StatCard label="Completed" value={completed} valueClassName="text-emerald-300" />
            <StatCard label="In Progress" value={inProgress} valueClassName="text-primary" />
            <StatCard
              label="Avg Progress"
              value={`${avgProgress}%`}
              valueClassName={avgProgress >= 70 ? 'text-emerald-300' : avgProgress >= 40 ? 'text-amber-300' : 'text-red-400'}
            />
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-12 w-12" />}
            title="No schedule tasks yet"
            description={canManage ? 'Create the first work package and task.' : undefined}
            action={canManage ? { label: 'Add Task', href: `/projects/${projectId}/sites/${siteId}/schedules/new` } : undefined}
          />
        ) : (
          <div className="space-y-6">
            {/* Risk strip */}
            {hasRisk && (
              <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card/60 px-4 py-3">
                {riskSummary.overdue    > 0 && <RiskChip label="Overdue"     count={riskSummary.overdue}    color="red"   />}
                {riskSummary.blocked    > 0 && <RiskChip label="Blocked"     count={riskSummary.blocked}    color="red"   />}
                {riskSummary.dueToday   > 0 && <RiskChip label="Due Today"   count={riskSummary.dueToday}   color="amber" />}
                {riskSummary.delayed    > 0 && <RiskChip label="Delayed"     count={riskSummary.delayed}    color="amber" />}
                {riskSummary.behindPlan > 0 && <RiskChip label="Behind Plan" count={riskSummary.behindPlan} color="amber" />}
              </div>
            )}

            {/* Work Package Filter */}
            {packages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setPackageFilter('')}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${!packageFilter ? 'bg-primary text-primary-foreground' : 'bg-border text-muted-foreground hover:text-foreground'}`}
                >
                  All Tasks
                </button>
                {packages.map((pkg) => (
                  <button
                    key={pkg.id}
                    onClick={() => setPackageFilter(pkg.id === packageFilter ? '' : pkg.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${packageFilter === pkg.id ? 'bg-primary text-primary-foreground' : 'bg-border text-muted-foreground hover:text-foreground'}`}
                  >
                    {pkg.name}
                  </button>
                ))}
              </div>
            )}

            {/* Work Packages with Tasks */}
            {packages.length > 0 ? (
              packages
                .filter((pkg) => !packageFilter || pkg.id === packageFilter)
                .map((pkg) => {
                  const pkgTasks = filteredTasks.filter((t) => t.workPackageId === pkg.id);
                  const unassigned = filteredTasks.filter((t) => !t.workPackageId);
                  return (
                    <Card key={pkg.id}>
                      <CardHeader>
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-base">{pkg.name}</CardTitle>
                            {pkg.area && (
                              <p className="text-xs text-muted-foreground mt-0.5">{pkg.area}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant={STATUS_CONFIG[pkg.status]?.variant ?? 'secondary'}>
                              {STATUS_CONFIG[pkg.status]?.label}
                            </Badge>
                          </div>
                        </div>
                        {(pkg.startDate || pkg.endDate) && (
                          <p className="text-xs text-muted-foreground">
                            {pkg.startDate && new Date(pkg.startDate).toLocaleDateString()}
                            {pkg.startDate && pkg.endDate && ' – '}
                            {pkg.endDate && new Date(pkg.endDate).toLocaleDateString()}
                          </p>
                        )}
                      </CardHeader>
                      <Separator />
                      <CardContent className="pt-3">
                        {pkgTasks.length === 0 ? (
                          <p className="text-sm text-muted-foreground py-2">No tasks in this package.</p>
                        ) : (
                          <div className="space-y-2">
                            {pkgTasks.map((task) => <TaskRow key={task.id} task={task} projectId={projectId} siteId={siteId} today={today} />)}
                          </div>
                        )}
                        {!packageFilter && unassigned.length > 0 && pkg === packages[packages.length - 1] && (
                          <>
                            <Separator className="my-3" />
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Unassigned Tasks</p>
                            {unassigned.map((task) => <TaskRow key={task.id} task={task} projectId={projectId} siteId={siteId} today={today} />)}
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
            ) : (
              <div className="space-y-2">
                {filteredTasks.map((task) => <TaskRow key={task.id} task={task} projectId={projectId} siteId={siteId} today={today} />)}
              </div>
            )}

            {delayed > 0 && (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {delayed} task{delayed !== 1 ? 's are' : ' is'} delayed or blocked — review and update status.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, projectId, siteId, today }: { task: ScheduleTask; projectId: string; siteId: string; today: string }) {
  const cfg      = STATUS_CONFIG[task.status];
  const progress = task.actualProgress ? parseFloat(task.actualProgress) : 0;
  const risk     = getTaskRisk(task, today);
  const riskCls  = risk ? (RISK_ROW_CLASSES[risk] ?? '') : '';

  return (
    <Link href={`/projects/${projectId}/sites/${siteId}/schedules/${task.id}`}>
      <div className={`group flex items-center justify-between rounded-lg border border-border bg-navy-base px-3 py-3 transition-colors hover:bg-navy-elevated cursor-pointer ${riskCls}`}>
        <div className="min-w-0 flex-1 mr-3">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
              {task.title}
            </p>
            <Badge variant={cfg.variant} className="text-xs">{cfg.label}</Badge>
            {task.area && <span className="text-xs text-muted-foreground">{task.area}</span>}
          </div>
          {task.contractor && (
            <p className="text-xs text-muted-foreground mt-0.5">{task.contractor.name}</p>
          )}
          {task.actualProgress !== null && (
            <div className="mt-2 space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Progress</span>
                <span className="text-xs text-foreground">{progress}%</span>
              </div>
              <ProgressBar value={progress} />
            </div>
          )}
          {task.delayReason && (
            <p className="text-xs text-amber-400 mt-1">⚠ {task.delayReason}</p>
          )}
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 group-hover:text-primary transition-colors" />
      </div>
    </Link>
  );
}
