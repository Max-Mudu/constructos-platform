'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ApiError, labourApi } from '@/lib/api';
import type { LabourEntry } from '@/lib/types';
import { formatCalendarDate } from '@/lib/workflows-dates';
import { formErrorState } from '@/lib/workflows-form-errors';
import { formatQuantity } from '@/components/projects/format-quantity';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/** Mirrors labour.routes.ts: WRITE_ROLES may edit, DELETE_ROLES may delete. */
export const LABOUR_WRITE_ROLES  = ['company_admin', 'project_manager', 'site_supervisor'] as const;
export const LABOUR_DELETE_ROLES = ['company_admin', 'project_manager'] as const;

export function canEditLabour(role: string | undefined | null): boolean {
  return !!role && (LABOUR_WRITE_ROLES as readonly string[]).includes(role);
}

export function canDeleteLabour(role: string | undefined | null): boolean {
  return !!role && (LABOUR_DELETE_ROLES as readonly string[]).includes(role);
}

export function labourErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return 'You do not have permission to change labour entries on this site.';
    if (err.status === 404) return 'This labour entry no longer exists. Refresh the list.';
    if (err.status === 0 || err.status === 408) return 'Could not reach the server. Check your connection and try again.';
  }
  const { message } = formErrorState(err, [], fallback, { hoursWorked: 'Hours', dailyRate: 'Daily rate' });
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

function workerName(entry: LabourEntry): string {
  return `${entry.worker.firstName} ${entry.worker.lastName}`.trim();
}

interface BaseProps {
  projectId: string;
  siteId:    string;
  entry:     LabourEntry;
  onClose:   () => void;
}

export interface EditLabourEntryDialogProps extends BaseProps {
  onDone: (entry: LabourEntry) => void;
}

/**
 * Edits hours and notes. The daily rate field appears only when the entry
 * carries a rate, which the API includes only for callers with financial
 * access (the same callers whose rate changes it accepts).
 */
export function EditLabourEntryDialog({ projectId, siteId, entry, onClose, onDone }: EditLabourEntryDialogProps) {
  const showRate = entry.dailyRate !== undefined;
  const [hours, setHours]       = useState(String(Number(entry.hoursWorked)));
  const [rate, setRate]         = useState(showRate ? String(Number(entry.dailyRate)) : '');
  const [notes, setNotes]       = useState(entry.notes ?? '');
  const [hoursError, setHoursError] = useState('');
  const [rateError, setRateError]   = useState('');
  const [error, setError]       = useState('');
  const [busy, setBusy]         = useState(false);
  const busyRef = useRef(false);
  const ref = useDialogFocus(onClose, busyRef);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busyRef.current) return;
    const h = Number(hours);
    const hErr = !hours.trim() || !Number.isFinite(h) || h <= 0 || h > 24 ? 'Enter hours greater than 0 and no more than 24.' : '';
    const r = Number(rate);
    const rErr = showRate && (!rate.trim() || !Number.isFinite(r) || r <= 0) ? 'Enter a daily rate greater than 0.' : '';
    setHoursError(hErr);
    setRateError(rErr);
    if (hErr || rErr) return;

    const trimmed = notes.trim();
    const data: Parameters<typeof labourApi.update>[3] = {
      hoursWorked: h,
      notes: trimmed ? trimmed : null,
      ...(showRate && r !== Number(entry.dailyRate) && { dailyRate: r }),
    };
    setError('');
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await labourApi.update(projectId, siteId, entry.id, data);
      busyRef.current = false;
      onDone(res.entry);
    } catch (err) {
      setError(labourErrorMessage(err, 'The labour entry could not be saved.'));
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
        aria-labelledby="labour-edit-title"
        className="relative z-10 w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-xl sm:rounded-2xl"
      >
        <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
          <div>
            <h2 id="labour-edit-title" className="text-lg font-semibold text-foreground">
              Edit labour entry
            </h2>
            <p className="text-sm text-muted-foreground">
              {workerName(entry)} · {formatCalendarDate(entry.date, 'short')}
            </p>
          </div>

          <Input
            id="labour-edit-hours"
            label="Hours worked"
            type="number"
            inputMode="decimal"
            min="0"
            max="24"
            step="any"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            error={hoursError}
            data-autofocus
          />
          {showRate && (
            <Input
              id="labour-edit-rate"
              label={`Daily rate${entry.currency ? ` (${entry.currency})` : ''}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              error={rateError}
            />
          )}
          <Input
            id="labour-edit-notes"
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

export interface DeleteLabourEntryDialogProps extends BaseProps {
  onDone: () => void;
}

/** Confirmation step before a labour entry is deleted. */
export function DeleteLabourEntryDialog({ projectId, siteId, entry, onClose, onDone }: DeleteLabourEntryDialogProps) {
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
      await labourApi.delete(projectId, siteId, entry.id);
      busyRef.current = false;
      onDone();
    } catch (err) {
      setError(labourErrorMessage(err, 'The labour entry could not be deleted.'));
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
        aria-labelledby="labour-delete-title"
        aria-describedby="labour-delete-desc"
        className="relative z-10 w-full max-w-md rounded-t-2xl border border-border bg-card p-5 shadow-xl sm:rounded-2xl space-y-4"
      >
        <h2 id="labour-delete-title" className="text-lg font-semibold text-foreground">
          Delete this labour entry?
        </h2>
        <p id="labour-delete-desc" className="text-sm text-muted-foreground">
          {workerName(entry)} · {formatCalendarDate(entry.date, 'short')} · {formatQuantity(entry.hoursWorked)}h.
          The entry is removed from the register and labour totals. This cannot be undone.
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
            {busy ? 'Deleting…' : 'Delete entry'}
          </Button>
        </div>
      </div>
    </div>
  );
}
