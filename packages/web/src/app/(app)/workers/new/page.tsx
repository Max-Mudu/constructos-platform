'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { workerApi, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';

export default function NewWorkerPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    idNumber: '',
    trade: '',
    dailyWage: '',
    currency: 'KES',
    emergencyContactName: '',
    emergencyContactPhone: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setFieldErrors({});

    try {
      const payload: Record<string, unknown> = {
        firstName: form.firstName,
        lastName:  form.lastName,
        currency:  form.currency,
      };
      if (form.email)                payload.email                = form.email;
      if (form.phone)                payload.phone                = form.phone;
      if (form.idNumber)             payload.idNumber             = form.idNumber;
      if (form.trade)                payload.trade                = form.trade;
      if (form.dailyWage)            payload.dailyWage            = Number(form.dailyWage);
      if (form.emergencyContactName) payload.emergencyContactName = form.emergencyContactName;
      if (form.emergencyContactPhone) payload.emergencyContactPhone = form.emergencyContactPhone;
      if (form.notes)                payload.notes                = form.notes;

      const { worker } = await workerApi.create(payload as Parameters<typeof workerApi.create>[0]);
      router.push(`/workers/${worker.id}`);
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

  return (
    <div className="px-6 py-8 max-w-2xl space-y-6 animate-fade-in">
      <Breadcrumb items={[{ label: 'Workers', href: '/workers' }, { label: 'Add Worker' }]} />
      <PageHeader title="Add Worker" subtitle="Register a new worker to your workforce." />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Personal info */}
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
              placeholder="+254 7XX XXX XXX"
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
              placeholder="Mason, Carpenter, Electrician…"
              error={fieldErrors.trade?.[0]}
            />
          </CardContent>
        </Card>

        {/* Pay */}
        <Card>
          <CardHeader><CardTitle className="text-base">Pay Rate</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Input
              label="Daily Wage"
              type="number"
              value={form.dailyWage}
              onChange={(e) => set('dailyWage', e.target.value)}
              placeholder="1500"
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
          </CardContent>
        </Card>

        {/* Emergency contact */}
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

        {/* Notes */}
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
          <Link href="/workers">
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Add Worker'}
          </Button>
        </div>
      </form>
    </div>
  );
}
