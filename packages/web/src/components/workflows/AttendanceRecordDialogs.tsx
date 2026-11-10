'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ApiError, attendanceApi } from '@/lib/api';
import type { AttendanceRecord, AttendanceStatus } from '@/lib/types';
import { formatCalendarDate } from '@/lib/workflows-dates';
import { formErrorState } from '@/lib/workflows-form-errors';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

/** Mirrors attendance.routes.ts: WRITE_ROLES may edit, DELETE_ROLES may delete. */
export const ATTENDANCE_WRITE_ROLES  = ['company_admin', 'project_manager', 'site_supervisor'] as const;
export const ATTENDANCE_DELETE_ROLES = ['company_admin', 'project_manager'] as const;

export function canEditAttendance(role: string | undefined | null): boolean {
  return !!role && (ATTENDANCE_WRITE_ROLES as readonly string[]).includes(role);
}

export function canDeleteAttendance(role: string | undefined | null): boolean {
  return !!role && (ATTENDANCE_DELETE_ROLES as readonly string[]).includes(role);
}

export const ATTENDANCE_STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present', absent: 'Absent', late: 'Late', half_day: 'Half Day', excused: 'Excused',
};

/** The API accepts HH:MM (24-hour) only. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A time input may report seconds ("07:30:00"); the API stores HH:MM. */
function toHHMM(value: string): string {
  const v = value.trim();
  return /^\d{2}:\d{2}:\d{2}/.test(v) ? v.slice(0, 5) : v;
}

export function attendanceErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'You do not have permission to change attendance records on this site.';
    if (err.status === 404) return 'This attendance record no longer exists. Refresh the list.';
    if (err.status === 0 || err.status === 408) return 'Could not reach the server. Check your connection and try again.';
  }
  const { message } = formErrorState(err, [], fallback, {
    checkInTime: 'Check-in', checkOutTime: 'Check-out',
  });
  return message || fallback;
}

/** Modal shell shared by both dialogs: focus in, Escape/backdrop cancel, focus restored. */
function useDialogFocus(onClose: () => void, busyRef: React.MutableRefObject<boolean>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busyRef.current) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose, busyRef]);
  return ref;
}

function workerName(record: AttendanceRecord): string {
  return `${record.worker.firstName} ${record.worker.lastName}`.trim();
}

interface BaseProps {
  projectId: string;
  siteId:    string;
  record:    AttendanceRecord;
  onClose:   () => void;
}

export interface EditAttendanceRecordDialogProps extends BaseProps {
  onDone: (record: AttendanceRecord) => void;
}

/**
 * Corrects a record's status, check-in/check-out times and notes. The worker
 * and the date are fixed by the API; a record for the wrong worker or day is
 * deleted and added again.
 */
export function EditAttendanceRecordDialog({ projectId, siteId, record, onClose, onDone }: EditAttendanceRecordDialogProps) {
  const [status, setStatus]     = useState<AttendanceStatus>(record.status);
  const [checkIn, setCheckIn]   = useState(record.checkInTime ?? '');
  const [checkOut, setCheckOut] = useState(record.checkOutTime ?? '');
  const [notes, setNotes]       = useState(record.notes ?? '');
  const [checkInError, setCheckInError]   = useState('');
  const [checkOutError, setCheckOutError] = useState('');
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);
  const busyRef = useRef(false);
  const ref = useDialogFocus(onClose, busyRef);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    const inTime  = toHHMM(checkIn);
    const outTime = toHHMM(checkOut);
    const inErr  = inTime  && !TIME_RE.test(inTime)  ? 'Enter the check-in time as HH:MM.'  : '';
    const outErr = outTime && !TIME_RE.test(outTime) ? 'Enter the check-out time as HH:MM.' : '';
    setCheckInError(inErr);
    setCheckOutError(outErr);
    if (inErr || outErr) return;

    const trimmed = notes.trim();
    const data: Parameters<typeof attendanceApi.update>[3] = {
      status,
      checkInTime:  inTime  || null,
      checkOutTime: outTime || null,
      notes:        trimmed ? trimmed : null,
    };
    setError('');
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await attendanceApi.update(projectId, siteId, record.id, data);
      busyRef.current = false;
      onDone(res.record);
    } catch (err) {
      setError(attendanceErrorMessage(err, 'The attendance record could not be saved.'));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-[#121826]/50" aria-hidden onClick={() => { if (!busyRef.current) onClose(); }} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="attendance-edit-title"
        className="relative z-10 w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-xl sm:rounded-2xl"
      >
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          <div>
            <h2 id="attendance-edit-title" className="text-lg font-semibold text-foreground">
              Edit attendance record
            </h2>
            <p className="text-sm text-muted-foreground">
              {workerName(record)} · {formatCalendarDate(record.date, 'short')}
            </p>
          </div>

          <Select
            id="attendance-edit-status"
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
            data-autofocus
          >
            {(Object.keys(ATTENDANCE_STATUS_LABELS) as AttendanceStatus[]).map((s) => (
              <option key={s} value={s}>{ATTENDANCE_STATUS_LABELS[s]}</option>
            ))}
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Input
              id="attendance-edit-check-in"
              label="Check-in time"
              type="time"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              error={checkInError}
            />
            <Input
              id="attendance-edit-check-out"
              label="Check-out time"
              type="time"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
              error={checkOutError}
            />
          </div>

          <Input
            id="attendance-edit-notes"
            label="Notes"
            value={notes}
            maxLength={2000}
            onChange={(e) => setNotes(e.target.value)}
          />

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button type="submit" loading={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export interface DeleteAttendanceRecordDialogProps extends BaseProps {
  onDone: () => void;
}

/** Confirmation step before an attendance record is deleted. */
export function DeleteAttendanceRecordDialog({ projectId, siteId, record, onClose, onDone }: DeleteAttendanceRecordDialogProps) {
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);
  const busyRef = useRef(false);
  const ref = useDialogFocus(onClose, busyRef);

  async function confirm() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      await attendanceApi.delete(projectId, siteId, record.id);
      busyRef.current = false;
      onDone();
    } catch (err) {
      setError(attendanceErrorMessage(err, 'The attendance record could not be deleted.'));
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-[#121826]/50" aria-hidden onClick={() => { if (!busyRef.current) onClose(); }} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="attendance-delete-title"
        aria-describedby="attendance-delete-desc"
        className="relative z-10 w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-xl sm:rounded-2xl space-y-4"
      >
        <h2 id="attendance-delete-title" className="text-lg font-semibold text-foreground">
          Delete this attendance record?
        </h2>
        <p id="attendance-delete-desc" className="text-sm text-muted-foreground">
          {workerName(record)} · {formatCalendarDate(record.date, 'short')} · {ATTENDANCE_STATUS_LABELS[record.status]}.
          The record is removed from the register and the totals for the day. This cannot be undone.
        </p>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy} data-autofocus>Cancel</Button>
          <Button variant="destructive" onClick={() => void confirm()} loading={busy}>
            {busy ? 'Deleting…' : 'Delete record'}
          </Button>
        </div>
      </div>
    </div>
  );
}
