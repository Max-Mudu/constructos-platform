'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { attendanceApi, ApiError } from '@/lib/api';
import { AttendanceRecord, AttendanceSummary, AttendanceStatus } from '@/lib/types';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { SearchFilterBar } from '@/components/ui/SearchFilterBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, TableHead, TableRow, TableHeader, TableBody, TableCell } from '@/components/ui/Table';
import { ClipboardCheck, Plus, AlertCircle, Clock } from 'lucide-react';

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present', absent: 'Absent', late: 'Late', half_day: 'Half Day', excused: 'Excused',
};

const STATUS_VARIANT: Record<AttendanceStatus, 'active' | 'inactive' | 'pending' | 'info'> = {
  present: 'active', absent: 'inactive', late: 'pending', half_day: 'info', excused: 'info',
};

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

function today(): string { return new Date().toISOString().split('T')[0]; }

export default function AttendancePage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>();

  const [records,  setRecords]  = useState<AttendanceRecord[]>([]);
  const [summary,  setSummary]  = useState<AttendanceSummary | null>(null);
  const [date,     setDate]     = useState(today());
  const [statusF,  setStatusF]  = useState('');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const load = (d: string) => {
    if (!projectId || !siteId) return;
    setLoading(true); setError('');
    Promise.all([
      attendanceApi.list(projectId, siteId, { date: d }),
      attendanceApi.summary(projectId, siteId, d),
    ])
      .then(([r, s]) => { setRecords(r.records); setSummary(s.summary); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load attendance'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(date); }, [projectId, siteId, date]);

  const filtered = statusF ? records.filter((r) => r.status === statusF) : records;

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <Breadcrumb items={[
        { label: 'Projects', href: '/projects' },
        { label: 'Project', href: `/projects/${projectId}` },
        { label: 'Site', href: `/projects/${projectId}/sites/${siteId}` },
        { label: 'Attendance' },
      ]} />

      <PageHeader
        title="Attendance"
        subtitle={`Records for ${date}`}
        action={
          <Link href={`/projects/${projectId}/sites/${siteId}/attendance/new`}>
            <Button><Plus className="h-4 w-4" /> Add Record</Button>
          </Link>
        }
      />

      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Present"  value={summary.present}  icon={<ClipboardCheck className="h-4 w-4" />} valueClassName="text-emerald-300" />
          <StatCard label="Absent"   value={summary.absent}   valueClassName="text-red-400" />
          <StatCard label="Late"     value={summary.late}     valueClassName="text-amber-300" />
          <StatCard label="Half Day" value={summary.half_day} valueClassName="text-blue-300" />
          <StatCard label="Excused"  value={summary.excused}  valueClassName="text-blue-300" />
        </div>
      )}

      <SearchFilterBar
        filters={[
          { label: 'Status', value: statusF, options: STATUS_OPTIONS, onChange: setStatusF },
        ]}
      >
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-9 rounded-lg border border-border bg-navy-base px-3 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </SearchFilterBar>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-12 w-12" />}
          title="No attendance records for this date"
          action={{ label: 'Add Record', href: `/projects/${projectId}/sites/${siteId}/attendance/new` }}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Worker</TableHead>
              <TableHead>Trade</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Check-in</TableHead>
              <TableHead>Check-out</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Recorded By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.worker.firstName} {r.worker.lastName}</TableCell>
                <TableCell className="text-muted-foreground">{r.worker.trade ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABELS[r.status]}</Badge>
                </TableCell>
                <TableCell>
                  {r.checkInTime ? <span className="inline-flex items-center gap-1 text-sm"><Clock className="h-3 w-3" />{r.checkInTime}</span> : '—'}
                </TableCell>
                <TableCell>
                  {r.checkOutTime ? <span className="inline-flex items-center gap-1 text-sm"><Clock className="h-3 w-3" />{r.checkOutTime}</span> : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-[200px] truncate">{r.notes ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{r.recordedBy.firstName} {r.recordedBy.lastName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
