'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { workerApi, ApiError } from '@/lib/api';
import { WorkerEmploymentStatus } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Skeleton } from '@/components/ui/Skeleton';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';

const EMPLOYMENT_OPTIONS: { value: WorkerEmploymentStatus; label: string }[] = [
  { value: 'active',    label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'inactive',  label: 'Inactive' },
];

export default function EditWorkerPage() {
  const { workerId } = useParams<{ workerId: string }>();
  const router = useRouter();

  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', phone: '', idNumber: '',
    trade: '', dailyWage: '', currency: 'KES',
    employmentStatus: 'active' as WorkerEmploymentStatus,
    emergencyContactName: '', emergencyContactPhone: '', notes: '',
  });
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  useEffect(() => {
    if (!workerId) return;
    workerApi
      .get(workerId)
      .then(({ worker }) => {
        setForm({
          firstName:            worker.firstName,
          lastName:             worker.lastName,
          email:                worker.email          ?? '',
          phone:                worker.phone          ?? '',
          idNumber:             worker.idNumber       ?? '',
          trade:                worker.trade          ?? '',
          dailyWage:            worker.dailyWage      ? String(Number(worker.dailyWage)) : '',
          currency:             worker.currency,
          employmentStatus:     worker.employmentStatus,
          emergencyContactName: worker.emergencyContactName  ?? '',
          emergencyContactPhone: worker.emergencyContactPhone ?? '',
          notes:                worker.notes          ?? '',
        });
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [workerId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setFieldErrors({});

    try {
      await workerApi.update(workerId, {
        firstName:             form.firstName,
        lastName:              form.lastName,
        email:                 form.email   || null,
        phone:                 form.phone   || null,
        idNumber:              form.idNumber || null,
        trade:                 form.trade   || null,
        dailyWage:             form.dailyWage ? Number(form.dailyWage) : null,
        currency:              form.currency,
        employmentStatus:      form.employmentStatus,
        emergencyContactName:  form.emergencyContactName  || null,
        emergencyContactPhone: form.emergencyContactPhone || null,
        notes:                 form.notes || null,
      });
      router.push(`/workers/${workerId}`);
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

  if (loading) {
    return (
      <div className="px-6 py-8 max-w-2xl space-y-4 animate-fade-in">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="px-6 py-8 max-w-2xl space-y-6 animate-fade-in">
      <Breadcrumb items={[
        { label: 'Workers', href: '/workers' },
        { label: 'Worker', href: `/workers/${workerId}` },
        { label: 'Edit' },
      ]} />
      <PageHeader title="Edit Worker" />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Personal Information</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Input
              label="First Name"
              value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)}
              required
              error={fieldErrors.firstName?.[0]}
            />
            <Input
              label="Last Name"
              value={form.lastName}
              onChange={(e) => set('lastName', e.target.value)}
              required
              error={fieldErrors.lastName?.[0]}
            />
            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              error={fieldErrors.email?.[0]}
            />
            <Input
              label="Phone"
              type="tel"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              error={fieldErrors.phone?.[0]}
            />
            <Input
              label="ID / National ID"
              value={form.idNumber}
              onChange={(e) => set('idNumber', e.target.value)}
              error={fieldErrors.idNumber?.[0]}
            />
            <Input
              label="Trade / Skill"
              value={form.trade}
              onChange={(e) => set('trade', e.target.value)}
              error={fieldErrors.trade?.[0]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Pay Rate & Status</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Input
              label="Daily Wage"
              type="number"
              value={form.dailyWage}
              onChange={(e) => set('dailyWage', e.target.value)}
              error={fieldErrors.dailyWage?.[0]}
            />
            <Select
              label="Currency"
              value={form.currency}
              onChange={(e) => set('currency', e.target.value)}
            >
              <option value="KES">KES</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </Select>
            <div className="col-span-2">
              <Select
                label="Employment Status"
                value={form.employmentStatus}
                onChange={(e) => set('employmentStatus', e.target.value)}
              >
                {EMPLOYMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Emergency Contact</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Input
              label="Contact Name"
              value={form.emergencyContactName}
              onChange={(e) => set('emergencyContactName', e.target.value)}
              error={fieldErrors.emergencyContactName?.[0]}
            />
            <Input
              label="Contact Phone"
              type="tel"
              value={form.emergencyContactPhone}
              onChange={(e) => set('emergencyContactPhone', e.target.value)}
              error={fieldErrors.emergencyContactPhone?.[0]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              placeholder="Optional notes…"
              className={cn(
                'flex w-full rounded-lg border border-border bg-navy-base px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground',
                'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-50 resize-none',
              )}
            />
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Link href={`/workers/${workerId}`}>
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </div>
  );
}
