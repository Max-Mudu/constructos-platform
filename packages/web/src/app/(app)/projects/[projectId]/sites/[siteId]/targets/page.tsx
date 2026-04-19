'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { targetsApi, ApiError } from '@/lib/api';
import { DailyTarget, TargetSummary } from '@/lib/types';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableHead, TableRow, TableHeader, TableBody, TableCell } from '@/components/ui/Table';
import { Target, Plus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';

function today(): string { return new Date().toISOString().split('T')[0]; }

function pctColor(pct: number | null): string {
  if (pct === null) return 'text-muted-foreground';
  if (pct >= 100)   return 'text-emerald-300';
  if (pct >= 60)    return 'text-amber-300';
  return 'text-red-400';
}

export default function TargetsPage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>();
  const user = useAuthStore((s) => s.user);

  const [targets,   setTargets]   = useState<DailyTarget[]>([]);
  const [summary,   setSummary]   = useState<TargetSummary | null>(null);
  const [date,      setDate]      = useState(today());
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [approving, setApproving] = useState<string | null>(null);

  const canApprove = user?.role === 'company_admin' || user?.role === 'project_manager' || user?.role === 'site_supervisor';

  const load = (d: string) => {
    if (!projectId || !siteId) return;
    setLoading(true); setError('');
    Promise.all([
      targetsApi.list(projectId, siteId, { date: d }),
      targetsApi.summary(projectId, siteId, d),
    ])
      .then(([r, s]) => { setTargets(r.targets); setSummary(s.summary); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load targets'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(date); }, [projectId, siteId, date]);

  const handleApprove = async (targetId: string) => {
    setApproving(targetId);
    try {
      const { target } = await targetsApi.approve(projectId, siteId, targetId);
      setTargets((prev) => prev.map((t) => t.id === targetId ? target : t));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve target');
    } finally {
      setApproving(null);
    }
  };

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <Breadcrumb items={[
        { label: 'Projects', href: '/projects' },
        { label: 'Project', href: `/projects/${projectId}` },
        { label: 'Site', href: `/projects/${projectId}/sites/${siteId}` },
        { label: 'Daily Targets' },
      ]} />

      <PageHeader
        title="Daily Targets"
        subtitle={`Targets for ${date}`}
        action={
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-9 rounded-lg border border-border bg-navy-base px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Link href={`/projects/${projectId}/sites/${siteId}/targets/new`}>
              <Button><Plus className="h-4 w-4" /> Add Target</Button>
            </Link>
          </div>
        }
      />

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Targets"  value={summary.total}               icon={<Target className="h-4 w-4" />} />
          <StatCard label="Approved"       value={summary.approved}            valueClassName="text-emerald-300" />
          <StatCard label="With Actuals"   value={summary.withActual} />
          <StatCard label="Avg Completion" value={`${summary.avgCompletion}%`} valueClassName={pctColor(summary.avgCompletion)} />
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : targets.length === 0 ? (
        <EmptyState
          icon={<Target className="h-12 w-12" />}
          title="No targets set for this date"
          action={{ label: 'Add Target', href: `/projects/${projectId}/sites/${siteId}/targets/new` }}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Worker</TableHead>
              <TableHead className="text-right">Target</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Completion</TableHead>
              <TableHead>Status</TableHead>
              {canApprove && <TableHead>Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {targets.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium max-w-[200px]">
                  <div>
                    <p className="truncate">{t.description}</p>
                    {t.notes && <p className="text-xs text-muted-foreground truncate">{t.notes}</p>}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {t.worker ? `${t.worker.firstName} ${t.worker.lastName}` : 'Site-wide'}
                </TableCell>
                <TableCell className="text-right">{t.targetValue} {t.targetUnit}</TableCell>
                <TableCell className="text-right">{t.actualValue != null ? `${t.actualValue} ${t.targetUnit}` : '—'}</TableCell>
                <TableCell className="text-right">
                  <span className={`font-semibold ${pctColor(t.completionPct)}`}>
                    {t.completionPct != null ? `${t.completionPct}%` : '—'}
                  </span>
                </TableCell>
                <TableCell>
                  {t.approvedById
                    ? <Badge variant="active"><CheckCircle2 className="h-3 w-3 mr-1" /> Approved</Badge>
                    : <Badge variant="pending">Pending</Badge>}
                </TableCell>
                {canApprove && (
                  <TableCell>
                    {!t.approvedById && (
                      <Button size="sm" variant="outline" disabled={approving === t.id} onClick={() => handleApprove(t.id)}>
                        {approving === t.id ? 'Approving…' : 'Approve'}
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
