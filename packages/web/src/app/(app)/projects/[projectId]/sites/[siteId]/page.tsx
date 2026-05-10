'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { siteApi, attendanceApi, targetsApi, scheduleApi, workerApi, ApiError } from '@/lib/api';
import { JobSite, AttendanceSummary, TargetSummary, ScheduleSummary, Worker } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { StickyActionsRow } from '@/components/ui/StickyActionsRow';
import { QuickActions } from '@/components/ui/QuickActions';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Separator } from '@/components/ui/Separator';
import Link from 'next/link';
import {
  ClipboardCheck, Target, Truck, Users, AlertCircle, MapPin, Plus, ClipboardList,
  UserMinus, UserPlus,
} from 'lucide-react';

const ASSIGN_ROLES = new Set(['company_admin', 'project_manager']);

function todayStr(): string { return new Date().toISOString().split('T')[0]; }

export default function SiteDetailPage() {
  const { projectId, siteId }             = useParams<{ projectId: string; siteId: string }>();
  const user                              = useAuthStore((s) => s.user);
  const canAssign                         = user ? ASSIGN_ROLES.has(user.role) : false;

  const [site, setSite]                   = useState<JobSite | null>(null);
  const [attendance, setAttendance]       = useState<AttendanceSummary | null>(null);
  const [targetSummary, setTargetSummary] = useState<TargetSummary | null>(null);
  const [scheduleSummary, setScheduleSummary] = useState<ScheduleSummary | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error,   setError]               = useState('');

  // Assigned workers state
  const [assignedWorkers, setAssignedWorkers] = useState<Worker[]>([]);
  const [assignedLoading, setAssignedLoading] = useState(false);

  // Assign modal state
  const [showModal,    setShowModal]    = useState(false);
  const [allWorkers,   setAllWorkers]   = useState<Worker[]>([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [selectId,     setSelectId]     = useState('');
  const [assigning,    setAssigning]    = useState(false);
  const [modalError,   setModalError]   = useState('');

  // Remove state
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadAssignedWorkers = useCallback(async () => {
    if (!projectId || !siteId) return;
    setAssignedLoading(true);
    try {
      const res = await workerApi.listSiteWorkers(projectId, siteId);
      setAssignedWorkers(res.workers);
    } catch {
      // Non-fatal — assigned workers section just stays empty
    } finally {
      setAssignedLoading(false);
    }
  }, [projectId, siteId]);

  useEffect(() => {
    if (!projectId || !siteId) return;
    const today = todayStr();
    Promise.all([
      siteApi.get(projectId, siteId),
      attendanceApi.summary(projectId, siteId, today).catch(() => null),
      targetsApi.summary(projectId, siteId, today).catch(() => null),
      scheduleApi.getSummary(projectId, siteId).catch(() => null),
    ])
      .then(([s, a, t, sc]) => {
        setSite(s.site);
        if (a)  setAttendance(a.summary);
        if (t)  setTargetSummary(t.summary);
        if (sc) setScheduleSummary(sc.summary);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load site'))
      .finally(() => setLoading(false));

    void loadAssignedWorkers();
  }, [projectId, siteId, loadAssignedWorkers]);

  async function openAssignModal() {
    setShowModal(true);
    setSelectId('');
    setModalError('');
    setModalLoading(true);
    try {
      const res = await workerApi.list({ isActive: true });
      const assignedIds = new Set(assignedWorkers.map((w) => w.id));
      setAllWorkers(res.workers.filter((w) => !assignedIds.has(w.id)));
    } catch {
      setModalError('Failed to load workers');
    } finally {
      setModalLoading(false);
    }
  }

  async function handleAssign() {
    if (!selectId || !projectId || !siteId) return;
    setAssigning(true);
    setModalError('');
    try {
      await workerApi.assignToSite(projectId, siteId, selectId);
      setShowModal(false);
      await loadAssignedWorkers();
    } catch (e) {
      setModalError(e instanceof ApiError ? e.message : 'Failed to assign worker');
    } finally {
      setAssigning(false);
    }
  }

  async function handleRemove(workerId: string) {
    if (!projectId || !siteId) return;
    setRemovingId(workerId);
    try {
      await workerApi.removeFromSite(projectId, siteId, workerId);
      await loadAssignedWorkers();
    } catch {
      // Silently ignore — worker list will stay unchanged
    } finally {
      setRemovingId(null);
    }
  }

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-6 animate-fade-in">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-8 w-56" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert>
      </div>
    );
  }

  if (!site) return null;

  return (
    <div className="animate-fade-in">
      <StickyActionsRow title={site.name} />

      <div className="px-6 py-8 space-y-8">
        <div className="space-y-4">
          <Breadcrumb items={[
            { label: 'Projects', href: '/projects' },
            { label: 'Project', href: `/projects/${projectId}` },
            { label: site.name },
          ]} />
          <PageHeader title={site.name} subtitle={site.address ?? undefined} />
          {!site.isActive && <Badge variant="inactive">Inactive</Badge>}
          {site.address && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4" />{site.address}
            </p>
          )}
        </div>

        {/* Today's summary stats */}
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Today&apos;s Summary</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Present"
              value={attendance?.present ?? '—'}
              icon={<ClipboardCheck className="h-5 w-5" />}
              valueClassName="text-emerald-300"
            />
            <StatCard label="Absent" value={attendance?.absent ?? '—'} valueClassName="text-red-400" />
            <StatCard label="Targets Set" value={targetSummary?.total ?? '—'} icon={<Target className="h-5 w-5" />} />
            <StatCard
              label="Avg Completion"
              value={targetSummary ? `${targetSummary.avgCompletion}%` : '—'}
              valueClassName={
                targetSummary?.avgCompletion != null && targetSummary.avgCompletion >= 80
                  ? 'text-emerald-300'
                  : 'text-amber-300'
              }
            />
          </div>
        </div>

        {/* Schedule summary */}
        {scheduleSummary && scheduleSummary.tasks.total > 0 && (
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contractor Schedule</p>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard
                label="Tasks"
                value={scheduleSummary.tasks.total}
                icon={<ClipboardList className="h-5 w-5" />}
              />
              <StatCard
                label="Completed"
                value={scheduleSummary.tasks.completed}
                valueClassName="text-emerald-300"
              />
              <StatCard
                label="In Progress"
                value={scheduleSummary.tasks.inProgress}
                valueClassName="text-primary"
              />
              <StatCard
                label="Avg Progress"
                value={`${scheduleSummary.tasks.avgProgress}%`}
                valueClassName={
                  scheduleSummary.tasks.avgProgress >= 70
                    ? 'text-emerald-300'
                    : 'text-amber-300'
                }
              />
            </div>
            {(scheduleSummary.tasks.delayed > 0 || scheduleSummary.tasks.blocked > 0) && (
              <p className="mt-2 text-xs text-amber-400">
                ⚠ {scheduleSummary.tasks.delayed + scheduleSummary.tasks.blocked} task(s) delayed or blocked
              </p>
            )}
          </div>
        )}

        {/* Assigned Workers */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Assigned Workers
              {assignedWorkers.length > 0 && (
                <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {assignedWorkers.length}
                </span>
              )}
            </CardTitle>
            {canAssign && (
              <Button size="sm" variant="outline" onClick={() => void openAssignModal()}>
                <UserPlus className="h-4 w-4 mr-1" />Assign Worker
              </Button>
            )}
          </CardHeader>
          <Separator />
          <CardContent className="pt-3">
            {assignedLoading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => <Skeleton key={i} className="h-8 w-full rounded-lg" />)}
              </div>
            ) : assignedWorkers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-1">No workers assigned to this site.</p>
            ) : (
              <div className="divide-y divide-border">
                {assignedWorkers.map((w) => (
                  <div key={w.id} className="flex items-center justify-between py-2.5">
                    <div>
                      <p className="text-sm font-medium">{w.firstName} {w.lastName}</p>
                      {w.trade && <p className="text-xs text-muted-foreground">{w.trade}</p>}
                    </div>
                    {canAssign && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={removingId === w.id}
                        onClick={() => void handleRemove(w.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
                      >
                        <UserMinus className="h-4 w-4" />
                        <span className="ml-1 hidden sm:inline">
                          {removingId === w.id ? 'Removing…' : 'Remove'}
                        </span>
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick actions */}
        <QuickActions
          title="Site Actions"
          actions={[
            { label: 'Record Attendance', icon: <ClipboardCheck className="h-4 w-4" />, href: `/projects/${projectId}/sites/${siteId}/attendance/new`, variant: 'primary' },
            { label: 'Add Target',        icon: <Plus className="h-4 w-4" />,            href: `/projects/${projectId}/sites/${siteId}/targets/new` },
            { label: 'Log Labour',        icon: <Users className="h-4 w-4" />,           href: `/projects/${projectId}/sites/${siteId}/labour/new` },
            { label: 'Record Delivery',   icon: <Truck className="h-4 w-4" />,           href: `/projects/${projectId}/sites/${siteId}/deliveries/new` },
          ]}
        />

        {/* Module links */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { href: `/projects/${projectId}/sites/${siteId}/attendance`, icon: ClipboardCheck, label: 'Attendance',       sub: 'Daily worker check-in/out'  },
            { href: `/projects/${projectId}/sites/${siteId}/targets`,    icon: Target,         label: 'Daily Targets',     sub: 'Set and track work targets' },
            { href: `/projects/${projectId}/sites/${siteId}/labour`,     icon: Users,          label: 'Labour Register',   sub: 'Track hours and wages'      },
            { href: `/projects/${projectId}/sites/${siteId}/deliveries`, icon: Truck,          label: 'Deliveries',        sub: 'Log material deliveries'    },
            { href: `/projects/${projectId}/sites/${siteId}/schedules`,  icon: ClipboardList,  label: 'Schedule',          sub: 'Contractor tasks & progress' },
          ].map(({ href, icon: Icon, label, sub }) => (
            <Link key={href} href={href} className="group flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-4 transition-colors hover:bg-navy-elevated">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                <Icon className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-foreground group-hover:text-primary transition-colors">{label}</p>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Assign Worker Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-navy-base p-6 space-y-4 shadow-xl">
            <h2 className="text-base font-semibold">Assign Worker to Site</h2>

            {modalError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{modalError}</AlertDescription>
              </Alert>
            )}

            {modalLoading ? (
              <Skeleton className="h-9 w-full rounded-lg" />
            ) : allWorkers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No unassigned active workers available.</p>
            ) : (
              <Select
                label="Worker"
                value={selectId}
                onChange={(e) => setSelectId(e.target.value)}
              >
                <option value="">Select a worker…</option>
                {allWorkers.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.firstName} {w.lastName}{w.trade ? ` — ${w.trade}` : ''}
                  </option>
                ))}
              </Select>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowModal(false)} disabled={assigning}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleAssign()}
                disabled={!selectId || assigning || modalLoading}
              >
                {assigning ? 'Assigning…' : 'Assign'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
