'use client';

import { useEffect, useState, useCallback } from 'react';
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
  const { projectId, siteId }     = useParams<{ projectId: string; siteId: string }>();
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
                            {pkgTasks.map((task) => <TaskRow key={task.id} task={task} projectId={projectId} siteId={siteId} />)}
                          </div>
                        )}
                        {!packageFilter && unassigned.length > 0 && pkg === packages[packages.length - 1] && (
                          <>
                            <Separator className="my-3" />
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Unassigned Tasks</p>
                            {unassigned.map((task) => <TaskRow key={task.id} task={task} projectId={projectId} siteId={siteId} />)}
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })
            ) : (
              <div className="space-y-2">
                {filteredTasks.map((task) => <TaskRow key={task.id} task={task} projectId={projectId} siteId={siteId} />)}
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

function TaskRow({ task, projectId, siteId }: { task: ScheduleTask; projectId: string; siteId: string }) {
  const cfg     = STATUS_CONFIG[task.status];
  const progress = task.actualProgress ? parseFloat(task.actualProgress) : 0;

  return (
    <Link href={`/projects/${projectId}/sites/${siteId}/schedules/${task.id}`}>
      <div className="group flex items-center justify-between rounded-lg border border-border bg-navy-base px-3 py-3 transition-colors hover:bg-navy-elevated cursor-pointer">
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
