'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { siteApi, attendanceApi, targetsApi, scheduleApi, ApiError } from '@/lib/api';
import { JobSite, AttendanceSummary, TargetSummary, ScheduleSummary } from '@/lib/types';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { StickyActionsRow } from '@/components/ui/StickyActionsRow';
import { QuickActions } from '@/components/ui/QuickActions';
import { StatCard } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import Link from 'next/link';
import {
  ClipboardCheck, Target, Truck, Users, AlertCircle, MapPin, Plus, ClipboardList,
} from 'lucide-react';

function todayStr(): string { return new Date().toISOString().split('T')[0]; }

export default function SiteDetailPage() {
  const { projectId, siteId }             = useParams<{ projectId: string; siteId: string }>();
  const [site, setSite]                   = useState<JobSite | null>(null);
  const [attendance, setAttendance]       = useState<AttendanceSummary | null>(null);
  const [targetSummary, setTargetSummary] = useState<TargetSummary | null>(null);
  const [scheduleSummary, setScheduleSummary] = useState<ScheduleSummary | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error,   setError]               = useState('');

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
  }, [projectId, siteId]);

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
          { href: `/projects/${projectId}/sites/${siteId}/schedules`, icon: ClipboardList, label: 'Schedule',         sub: 'Contractor tasks & progress' },
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
    </div>
  );
}
