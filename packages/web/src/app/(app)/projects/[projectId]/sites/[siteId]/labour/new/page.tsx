'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { labourApi, workerApi } from '@/lib/api';
import { formErrorState } from '@/lib/workflows-form-errors';
import { useRevealError } from '@/hooks/useRevealError';
import { localToday } from '@/lib/workflows-dates';
import { entryWage, rateForWorker } from '@/lib/workflows-labour';
import { bookableWorkers } from '@/lib/worker-filters';
import { Worker } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { ArrowLeft, AlertCircle } from 'lucide-react';

// Matches the list offered by the worker, budget and invoice forms. A labour
// entry inherits its currency from the selected worker, so every currency a
// worker can be paid in must be renderable here.
const CURRENCIES = ['USD', 'EUR', 'GBP', 'ZAR', 'AED', 'NGN', 'KES', 'GHS'];

export default function NewLabourEntryPage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>()!;
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  // Mirrors the API's canViewFinancialData. Without it the server derives the
  // rate from the worker's wage and ignores any submitted rate, so the form
  // neither asks for nor shows one.
  const canSetRate = !!user && (['super_admin', 'company_admin', 'finance_officer'].includes(user.role)
    || (user.role === 'project_manager' && user.canViewFinance));

  const [siteWorkers, setSiteWorkers] = useState<Worker[]>([]);
  const [onlyInactive, setOnlyInactive] = useState(false);
  const [form, setForm] = useState({
    workerId: '',
    date: localToday(),
    hoursWorked: '8',
    dailyRate: '',
    currency: 'KES',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const errorRef = useRevealError(error);

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  // Load the active workers assigned to this site (labour cannot be recorded
  // for an inactive worker).
  useEffect(() => {
    if (!projectId || !siteId) return;
    workerApi
      .listSiteWorkers(projectId, siteId)
      .then((d) => {
        const workers = bookableWorkers(d.workers);
        setSiteWorkers(workers);
        setOnlyInactive(d.workers.length > 0 && workers.length === 0);
        // Pre-select first worker if available
        if (workers.length > 0) {
          const w = workers[0];
          setForm((f) => ({
            ...f,
            workerId:  w.id,
            dailyRate: rateForWorker(w.dailyWage),
            currency:  w.currency ?? 'KES',
          }));
        }
      })
      .catch(() => setError('Failed to load site workers'));
  }, [projectId, siteId]);

  // When worker selection changes, pre-fill their rate
  function handleWorkerChange(workerId: string) {
    const w = siteWorkers.find((x) => x.id === workerId);
    setForm((f) => ({
      ...f,
      workerId,
      // A worker with no wage on record must not inherit the previous worker's rate.
      dailyRate: rateForWorker(w?.dailyWage),
      currency:  w?.currency ?? f.currency,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setFieldErrors({});

    try {
      // dailyRate/currency are sent only by finance users.
      await labourApi.create(projectId, siteId, {
        workerId:    form.workerId,
        date:        form.date,
        hoursWorked: Number(form.hoursWorked),
        ...(canSetRate && {
          dailyRate: Number(form.dailyRate),
          currency:  form.currency,
        }),
        notes:       form.notes || undefined,
      });
      router.push(`/projects/${projectId}/sites/${siteId}/labour`);
    } catch (e) {
      const shown = formErrorState(e, ['workerId', 'date', 'hoursWorked', 'dailyRate'], 'Something went wrong');
      setFieldErrors(shown.fieldErrors);
      // The banner is what is brought into view, so it also names inline-only errors.
      setError(shown.message || 'Please correct the highlighted fields below.');
    } finally {
      setSubmitting(false);
    }
  }

  const estimatedWage =
    canSetRate && form.hoursWorked && form.dailyRate
      ? entryWage(form).toLocaleString(undefined, {
          maximumFractionDigits: 0,
        })
      : null;

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/projects/${projectId}/sites/${siteId}/labour`}>
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-2xl font-bold">Log Labour Entry</h1>
      </div>

      <div ref={errorRef} tabIndex={-1} className={error ? 'outline-none' : 'hidden'}>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      {siteWorkers.length === 0 && !error && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {onlyInactive
              ? 'No active workers are assigned to this site. Labour cannot be recorded for an inactive worker.'
              : 'No workers are assigned to this site yet. Assign workers first from the site page.'}
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Worker & Date</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Worker <span className="text-destructive">*</span>
              </label>
              <select
                value={form.workerId}
                onChange={(e) => handleWorkerChange(e.target.value)}
                required
                disabled={siteWorkers.length === 0}
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {siteWorkers.length === 0 ? (
                  <option value="">No workers assigned</option>
                ) : (
                  siteWorkers.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.firstName} {w.lastName}{w.trade ? ` — ${w.trade}` : ''}
                    </option>
                  ))
                )}
              </select>
              {fieldErrors.workerId && (
                <p className="text-xs text-destructive mt-1">{fieldErrors.workerId[0]}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Date <span className="text-destructive">*</span>
              </label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => set('date', e.target.value)}
                required
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {fieldErrors.date && (
                <p className="text-xs text-destructive mt-1">{fieldErrors.date[0]}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">{canSetRate ? 'Hours & Rate' : 'Hours'}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className={canSetRate ? 'grid grid-cols-2 gap-4' : undefined}>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Hours Worked <span className="text-destructive">*</span>
                </label>
                <input
                  type="number"
                  value={form.hoursWorked}
                  onChange={(e) => set('hoursWorked', e.target.value)}
                  min="0.5"
                  max="24"
                  step="0.5"
                  required
                  className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {fieldErrors.hoursWorked && (
                  <p className="text-xs text-destructive mt-1">{fieldErrors.hoursWorked[0]}</p>
                )}
              </div>

              {canSetRate && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Daily Rate <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    value={form.dailyRate}
                    onChange={(e) => set('dailyRate', e.target.value)}
                    min="0"
                    step="1"
                    required
                    placeholder="1500"
                    className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {fieldErrors.dailyRate && (
                    <p className="text-xs text-destructive mt-1">{fieldErrors.dailyRate[0]}</p>
                  )}
                </div>
              )}
            </div>

            {canSetRate && (
              <div>
                <label className="block text-sm font-medium mb-1">Currency</label>
                <select
                  value={form.currency}
                  onChange={(e) => set('currency', e.target.value)}
                  className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}

            {estimatedWage && (
              <div className="bg-muted rounded-md px-4 py-3 text-sm">
                <span className="text-muted-foreground">Estimated wage: </span>
                <span className="font-semibold">{estimatedWage} {form.currency}</span>
                <span className="text-muted-foreground ml-2">
                  ({form.hoursWorked}h ÷ 8 × {Number(form.dailyRate).toLocaleString()} {form.currency})
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              placeholder="Optional notes about this labour entry…"
              className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Link href={`/projects/${projectId}/sites/${siteId}/labour`}>
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
          <Button type="submit" disabled={submitting || siteWorkers.length === 0}>
            {submitting ? 'Saving…' : 'Log Entry'}
          </Button>
        </div>
      </form>
    </div>
  );
}
