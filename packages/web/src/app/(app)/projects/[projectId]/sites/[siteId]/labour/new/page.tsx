'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { labourApi, workerApi, ApiError } from '@/lib/api';
import { Worker } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { ArrowLeft, AlertCircle } from 'lucide-react';

export default function NewLabourEntryPage() {
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>();
  const router = useRouter();

  const [siteWorkers, setSiteWorkers] = useState<Worker[]>([]);
  const [form, setForm] = useState({
    workerId: '',
    date: new Date().toISOString().slice(0, 10),
    hoursWorked: '8',
    dailyRate: '',
    currency: 'KES',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  // Load workers assigned to this site
  useEffect(() => {
    if (!projectId || !siteId) return;
    workerApi
      .listSiteWorkers(projectId, siteId)
      .then((d) => {
        setSiteWorkers(d.workers);
        // Pre-select first worker if available
        if (d.workers.length > 0) {
          const w = d.workers[0];
          setForm((f) => ({
            ...f,
            workerId:  w.id,
            dailyRate: w.dailyWage ? String(Number(w.dailyWage)) : '',
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
      dailyRate: w?.dailyWage ? String(Number(w.dailyWage)) : f.dailyRate,
      currency:  w?.currency ?? f.currency,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setFieldErrors({});

    try {
      await labourApi.create(projectId, siteId, {
        workerId:    form.workerId,
        date:        form.date,
        hoursWorked: Number(form.hoursWorked),
        dailyRate:   Number(form.dailyRate),
        currency:    form.currency,
        notes:       form.notes || undefined,
      });
      router.push(`/projects/${projectId}/sites/${siteId}/labour`);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.details) setFieldErrors(e.details);
        else setError(e.message);
      } else {
        setError('Something went wrong');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const estimatedWage =
    form.hoursWorked && form.dailyRate
      ? ((Number(form.hoursWorked) / 8) * Number(form.dailyRate)).toLocaleString(undefined, {
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

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {siteWorkers.length === 0 && !error && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No workers are assigned to this site yet. Assign workers first from the site page.
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
          <CardHeader><CardTitle className="text-base">Hours & Rate</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
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
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Currency</label>
              <select
                value={form.currency}
                onChange={(e) => set('currency', e.target.value)}
                className="w-full px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="KES">KES</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>

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
