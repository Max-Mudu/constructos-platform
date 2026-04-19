'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { scheduleApi, ApiError } from '@/lib/api';
import { ScheduleTask, ScheduleTaskStatus, MilestoneStatus } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { StickyActionsRow } from '@/components/ui/StickyActionsRow';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Separator } from '@/components/ui/Separator';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import {
  AlertCircle, CheckCircle2, Clock, AlertTriangle, Ban, Circle,
  Wrench, Package, MapPin, Calendar, ChevronRight,
  Flag, Link2, Plus,
} from 'lucide-react';

const STATUS_OPTIONS: { value: ScheduleTaskStatus; label: string }[] = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'delayed',     label: 'Delayed'     },
  { value: 'blocked',     label: 'Blocked'     },
  { value: 'completed',   label: 'Completed'   },
];

const MILESTONE_STATUS_OPTIONS: { value: MilestoneStatus; label: string }[] = [
  { value: 'pending',     label: 'Pending'     },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed',   label: 'Completed'   },
  { value: 'cancelled',   label: 'Cancelled'   },
];

const STATUS_VARIANT: Record<ScheduleTaskStatus, 'active' | 'pending' | 'secondary' | 'inactive' | 'destructive'> = {
  not_started: 'secondary',
  in_progress: 'active',
  delayed:     'pending',
  blocked:     'destructive',
  completed:   'secondary',
};

const MILESTONE_VARIANT: Record<MilestoneStatus, 'active' | 'pending' | 'secondary' | 'inactive'> = {
  pending:     'secondary',
  in_progress: 'active',
  completed:   'active',
  cancelled:   'inactive',
};

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 w-full rounded-full bg-border">
      <div
        className="h-2 rounded-full bg-primary transition-all"
        style={{ width: `${Math.min(100, value)}%` }}
      />
    </div>
  );
}

export default function TaskDetailPage() {
  const { projectId, siteId, taskId } = useParams<{ projectId: string; siteId: string; taskId: string }>();
  const { user }     = useAuthStore();
  const router       = useRouter();
  const [task, setTask]    = useState<ScheduleTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  // Progress update form
  const [progressForm, setProgressForm] = useState({
    actualProgress: '', status: '' as ScheduleTaskStatus | '',
    delayReason: '', comments: '',
  });
  const [savingProgress, setSavingProgress] = useState(false);
  const [progressSaved, setProgressSaved]   = useState(false);

  // Milestone form
  const [msForm, setMsForm]       = useState({ name: '', plannedDate: '' });
  const [addingMs, setAddingMs]   = useState(false);
  const [showMsForm, setShowMsForm] = useState(false);

  const canManage   = user?.role === 'company_admin' || user?.role === 'project_manager' || user?.role === 'contractor';
  const canProgress = canManage || user?.role === 'site_supervisor';

  const load = useCallback(() => {
    if (!projectId || !siteId || !taskId) return;
    scheduleApi.getTask(projectId, siteId, taskId)
      .then((d) => {
        setTask(d.task);
        setProgressForm({
          actualProgress: d.task.actualProgress ?? '',
          status:         d.task.status,
          delayReason:    d.task.delayReason ?? '',
          comments:       d.task.comments    ?? '',
        });
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load task'))
      .finally(() => setLoading(false));
  }, [projectId, siteId, taskId]);

  useEffect(() => { load(); }, [load]);

  async function saveProgress() {
    if (!projectId || !siteId || !taskId) return;
    setSavingProgress(true);
    try {
      await scheduleApi.updateTask(projectId, siteId, taskId, {
        actualProgress: progressForm.actualProgress !== '' ? Number(progressForm.actualProgress) : null,
        status:         progressForm.status || undefined,
        delayReason:    progressForm.delayReason || null,
        comments:       progressForm.comments    || null,
      });
      setProgressSaved(true);
      setTimeout(() => setProgressSaved(false), 2000);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to save');
    } finally {
      setSavingProgress(false);
    }
  }

  async function addMilestone() {
    if (!projectId || !siteId || !taskId || !msForm.name || !msForm.plannedDate) return;
    setAddingMs(true);
    try {
      await scheduleApi.createMilestone(projectId, siteId, taskId, {
        name:        msForm.name,
        plannedDate: msForm.plannedDate,
      });
      setMsForm({ name: '', plannedDate: '' });
      setShowMsForm(false);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to add milestone');
    } finally {
      setAddingMs(false);
    }
  }

  async function updateMilestoneStatus(milestoneId: string, status: MilestoneStatus) {
    if (!projectId || !siteId || !taskId) return;
    try {
      await scheduleApi.updateMilestone(projectId, siteId, taskId, milestoneId, {
        status,
        actualDate: status === 'completed' ? new Date().toISOString().split('T')[0] : null,
      });
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to update milestone');
    }
  }

  async function deleteTask() {
    if (!confirm('Delete this task? This cannot be undone.')) return;
    if (!projectId || !siteId || !taskId) return;
    try {
      await scheduleApi.deleteTask(projectId, siteId, taskId);
      router.push(`/projects/${projectId}/sites/${siteId}/schedules`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to delete task');
    }
  }

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-6 animate-fade-in">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (error && !task) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert>
      </div>
    );
  }

  if (!task) return null;

  const actualPct  = task.actualProgress  ? parseFloat(task.actualProgress)  : 0;
  const plannedPct = task.plannedProgress ? parseFloat(task.plannedProgress) : 0;

  return (
    <div className="animate-fade-in">
      <StickyActionsRow
        title={task.title}
        actions={
          canManage ? (
            <Button variant="destructive" size="sm" onClick={deleteTask}>Delete</Button>
          ) : undefined
        }
      />

      <div className="px-6 py-8 space-y-6">
        <div className="space-y-3">
          <Breadcrumb items={[
            { label: 'Projects', href: '/projects' },
            { label: 'Project', href: `/projects/${projectId}` },
            { label: 'Site', href: `/projects/${projectId}/sites/${siteId}` },
            { label: 'Schedule', href: `/projects/${projectId}/sites/${siteId}/schedules` },
            { label: task.title },
          ]} />
          <PageHeader title={task.title} subtitle={task.contractor.name} />
          <div className="flex flex-wrap gap-2">
            <Badge variant={STATUS_VARIANT[task.status]}>
              {STATUS_OPTIONS.find((s) => s.value === task.status)?.label}
            </Badge>
            {task.area && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />{task.area}
              </span>
            )}
            {task.workPackage && (
              <Link href={`/projects/${projectId}/sites/${siteId}/schedules`}>
                <span className="text-xs text-primary hover:underline cursor-pointer">
                  {task.workPackage.name}
                </span>
              </Link>
            )}
          </div>
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Progress */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progress</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Planned</span>
                <span className="text-foreground font-medium">{plannedPct}%</span>
              </div>
              <ProgressBar value={plannedPct} />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Actual</span>
                <span className={cn('font-medium', actualPct >= plannedPct ? 'text-emerald-300' : 'text-amber-300')}>
                  {actualPct}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-border">
                <div
                  className={cn('h-2 rounded-full transition-all', actualPct >= plannedPct ? 'bg-emerald-500' : 'bg-amber-500')}
                  style={{ width: `${Math.min(100, actualPct)}%` }}
                />
              </div>
            </div>

            {/* Schedule dates */}
            <div className="grid grid-cols-2 gap-4 text-sm pt-1">
              {task.plannedStartDate && (
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Planned Start</p>
                  <p className="text-foreground flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(task.plannedStartDate).toLocaleDateString()}
                  </p>
                </div>
              )}
              {task.plannedEndDate && (
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Planned End</p>
                  <p className="text-foreground flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(task.plannedEndDate).toLocaleDateString()}
                  </p>
                </div>
              )}
              {task.actualStartDate && (
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Actual Start</p>
                  <p className="text-emerald-300 flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(task.actualStartDate).toLocaleDateString()}
                  </p>
                </div>
              )}
              {task.actualEndDate && (
                <div>
                  <p className="text-muted-foreground text-xs mb-0.5">Actual End</p>
                  <p className="text-emerald-300 flex items-center gap-1">
                    <Calendar className="h-3.5 w-3.5" />
                    {new Date(task.actualEndDate).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Update Progress (editable) */}
        {canProgress && (
          <Card>
            <CardHeader><CardTitle className="text-base">Update Progress</CardTitle></CardHeader>
            <Separator />
            <CardContent className="pt-4 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Actual Progress (%)"
                  type="number"
                  value={String(progressForm.actualProgress)}
                  onChange={(e) => setProgressForm((f) => ({ ...f, actualProgress: e.target.value }))}
                  placeholder="0–100"
                />
                <Select
                  label="Status"
                  value={progressForm.status}
                  onChange={(e) => setProgressForm((f) => ({ ...f, status: e.target.value as ScheduleTaskStatus }))}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Delay Reason</label>
                <textarea
                  value={progressForm.delayReason}
                  onChange={(e) => setProgressForm((f) => ({ ...f, delayReason: e.target.value }))}
                  rows={2}
                  placeholder="Describe any delays or blockers…"
                  className={cn(
                    'flex w-full rounded-lg border border-border bg-navy-base px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground',
                    'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none',
                  )}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground">Comments</label>
                <textarea
                  value={progressForm.comments}
                  onChange={(e) => setProgressForm((f) => ({ ...f, comments: e.target.value }))}
                  rows={2}
                  placeholder="Optional comments…"
                  className={cn(
                    'flex w-full rounded-lg border border-border bg-navy-base px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground',
                    'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none',
                  )}
                />
              </div>
              <Button onClick={saveProgress} disabled={savingProgress}>
                {progressSaved ? '✓ Saved' : savingProgress ? 'Saving…' : 'Save Progress'}
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Resources */}
        {(task.materialsRequired || task.equipmentRequired || task.description) && (
          <Card>
            <CardHeader><CardTitle className="text-base">Scope & Resources</CardTitle></CardHeader>
            <Separator />
            <CardContent className="pt-4 space-y-3 text-sm">
              {task.description && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Description</p>
                  <p className="text-foreground">{task.description}</p>
                </div>
              )}
              {task.materialsRequired && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1 flex items-center gap-1">
                    <Package className="h-3.5 w-3.5" />Materials Required
                  </p>
                  <p className="text-foreground whitespace-pre-line">{task.materialsRequired}</p>
                </div>
              )}
              {task.equipmentRequired && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1 flex items-center gap-1">
                    <Wrench className="h-3.5 w-3.5" />Equipment Required
                  </p>
                  <p className="text-foreground whitespace-pre-line">{task.equipmentRequired}</p>
                </div>
              )}
              {task.comments && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1">Comments</p>
                  <p className="text-foreground">{task.comments}</p>
                </div>
              )}
              {task.delayReason && (
                <div>
                  <p className="text-amber-400 text-xs mb-1 flex items-center gap-1">
                    <AlertTriangle className="h-3.5 w-3.5" />Delay Reason
                  </p>
                  <p className="text-amber-300">{task.delayReason}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Dependencies */}
        {(task.outgoingDeps.length > 0 || task.incomingDeps.length > 0) && (
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Dependencies</CardTitle>
              </div>
            </CardHeader>
            <Separator />
            <CardContent className="pt-4 space-y-3 text-sm">
              {task.outgoingDeps.length > 0 && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1.5">Depends on (must complete first)</p>
                  <div className="space-y-1">
                    {task.outgoingDeps.map((d) => (
                      <Link key={d.dependsOnTask.id} href={`/projects/${projectId}/sites/${siteId}/schedules/${d.dependsOnTask.id}`}>
                        <div className="flex items-center gap-2 rounded-lg border border-border bg-navy-base px-3 py-2 hover:bg-navy-elevated transition-colors">
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-foreground hover:text-primary">{d.dependsOnTask.title}</span>
                          <Badge variant={STATUS_VARIANT[d.dependsOnTask.status]} className="ml-auto text-xs">
                            {d.dependsOnTask.status.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {task.incomingDeps.length > 0 && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1.5">Blocking (must complete before)</p>
                  <div className="space-y-1">
                    {task.incomingDeps.map((d) => (
                      <Link key={d.task.id} href={`/projects/${projectId}/sites/${siteId}/schedules/${d.task.id}`}>
                        <div className="flex items-center gap-2 rounded-lg border border-border bg-navy-base px-3 py-2 hover:bg-navy-elevated transition-colors">
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-foreground hover:text-primary">{d.task.title}</span>
                          <Badge variant={STATUS_VARIANT[d.task.status]} className="ml-auto text-xs">
                            {d.task.status.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Milestones */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flag className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Milestones</CardTitle>
              </div>
              {canManage && (
                <Button variant="outline" size="sm" onClick={() => setShowMsForm((v) => !v)}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              )}
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="pt-4 space-y-3">
            {showMsForm && (
              <div className="rounded-lg border border-border bg-navy-base p-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <Input
                      label="Milestone Name"
                      value={msForm.name}
                      onChange={(e) => setMsForm((f) => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Slab Pour Complete"
                    />
                  </div>
                  <Input
                    label="Planned Date"
                    type="date"
                    value={msForm.plannedDate}
                    onChange={(e) => setMsForm((f) => ({ ...f, plannedDate: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={addMilestone} disabled={addingMs || !msForm.name || !msForm.plannedDate}>
                    {addingMs ? 'Adding…' : 'Add Milestone'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowMsForm(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {task.milestones.length === 0 && !showMsForm ? (
              <p className="text-sm text-muted-foreground">No milestones set for this task.</p>
            ) : (
              task.milestones.map((ms) => (
                <div key={ms.id} className="flex items-start justify-between rounded-lg border border-border bg-navy-base px-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {ms.status === 'completed'
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                        : ms.status === 'cancelled'
                          ? <Ban className="h-4 w-4 text-muted-foreground shrink-0" />
                          : <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
                      }
                      <p className="text-sm font-medium text-foreground">{ms.name}</p>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 ml-6">
                      Planned: {new Date(ms.plannedDate).toLocaleDateString()}
                      {ms.actualDate && ` · Completed: ${new Date(ms.actualDate).toLocaleDateString()}`}
                    </p>
                  </div>
                  {canProgress && ms.status !== 'completed' && ms.status !== 'cancelled' && (
                    <Select
                      value={ms.status}
                      onChange={(e) => updateMilestoneStatus(ms.id, e.target.value as MilestoneStatus)}
                      className="w-36 text-xs"
                    >
                      {MILESTONE_STATUS_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </Select>
                  )}
                  {(ms.status === 'completed' || ms.status === 'cancelled') && (
                    <Badge variant={MILESTONE_VARIANT[ms.status]}>{ms.status}</Badge>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
