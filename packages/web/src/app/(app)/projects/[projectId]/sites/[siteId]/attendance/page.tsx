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
import { ClipboardCheck, Plus, AlertCircle, Clock, Pencil, Trash2, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { localToday } from '@/lib/workflows-dates';
import {
  EditAttendanceRecordDialog, DeleteAttendanceRecordDialog, canEditAttendance, canDeleteAttendance,
} from '@/components/workflows/AttendanceRecordDialogs';

const WRITE_ROLES = ['company_admin', 'project_manager', 'site_supervisor'] as const;
function canWrite(role: string) { return (WRITE_ROLES as readonly string[]).includes(role); }

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present', absent: 'Absent', late: 'Late', half_day: 'Half Day', excused: 'Excused',
};

const STATUS_VARIANT: Record<AttendanceStatus, 'active' | 'inactive' | 'pending' | 'info'> = {
  present: 'active', absent: 'inactive', late: 'pending', half_day: 'info', excused: 'info',
};

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

export default function AttendancePage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>()!;
  const user = useAuthStore((s) => s.user);
  const showAddButton = user && canWrite(user.role);

  const [records,  setRecords]  = useState<AttendanceRecord[]>([]);
  const [summary,  setSummary]  = useState<AttendanceSummary | null>(null);
  const [date,     setDate]     = useState(() => localToday());
  const [statusF,  setStatusF]  = useState('');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [editing,  setEditing]  = useState<AttendanceRecord | null>(null);
  const [deleting, setDeleting] = useState<AttendanceRecord | null>(null);
  const [notice,   setNotice]   = useState('');
  const mayEdit   = canEditAttendance(user?.role);
  const mayDelete = canDeleteAttendance(user?.role);

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

  useEffect(() => { setNotice(''); load(date); }, [projectId, siteId, date]);

  // The day's totals change when a status is corrected or a record is deleted.
  // If they cannot be re-read, hide the cards rather than show stale counts.
  const refreshSummary = () => {
    attendanceApi.summary(projectId, siteId, date)
      .then((s) => setSummary(s.summary))
      .catch(() => setSummary(null));
  };

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
          showAddButton ? (
            <Link href={`/projects/${projectId}/sites/${siteId}/attendance/new`}>
              <Button><Plus className="h-4 w-4" /> Add Record</Button>
            </Link>
          ) : undefined
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

      {notice && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

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
          action={showAddButton ? { label: 'Add Record', href: `/projects/${projectId}/sites/${siteId}/attendance/new` } : undefined}
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
              {(mayEdit || mayDelete) && <TableHead><span className="sr-only">Actions</span></TableHead>}
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
                {(mayEdit || mayDelete) && (
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      {mayEdit && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Edit attendance for ${r.worker.firstName} ${r.worker.lastName}`}
                          onClick={() => { setNotice(''); setEditing(r); }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {mayDelete && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete attendance for ${r.worker.firstName} ${r.worker.lastName}`}
                          onClick={() => { setNotice(''); setDeleting(r); }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {editing && (
        <EditAttendanceRecordDialog
          projectId={projectId}
          siteId={siteId}
          record={editing}
          onClose={() => setEditing(null)}
          onDone={(updated) => {
            setRecords((list) => list.map((x) => (x.id === updated.id ? updated : x)));
            setEditing(null);
            setNotice('Attendance record updated.');
            refreshSummary();
          }}
        />
      )}

      {deleting && (
        <DeleteAttendanceRecordDialog
          projectId={projectId}
          siteId={siteId}
          record={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setRecords((list) => list.filter((x) => x.id !== deleting.id));
            setDeleting(null);
            setNotice('Attendance record deleted.');
            refreshSummary();
          }}
        />
      )}
    </div>
  );
}
