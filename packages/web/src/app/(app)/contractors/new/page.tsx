'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { contractorApi, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { AlertCircle } from 'lucide-react';

export default function NewContractorPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    name: '', contactPerson: '', email: '', phone: '',
    registrationNumber: '', tradeSpecialization: '',
  });
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    setFieldErrors({});
    try {
      const payload: Parameters<typeof contractorApi.create>[0] = { name: form.name };
      if (form.contactPerson)     payload.contactPerson     = form.contactPerson;
      if (form.email)             payload.email             = form.email;
      if (form.phone)             payload.phone             = form.phone;
      if (form.registrationNumber) payload.registrationNumber = form.registrationNumber;
      if (form.tradeSpecialization) payload.tradeSpecialization = form.tradeSpecialization;

      const { contractor } = await contractorApi.create(payload);
      router.push(`/contractors/${contractor.id}`);
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
      <Breadcrumb items={[{ label: 'Contractors', href: '/contractors' }, { label: 'Add Contractor' }]} />
      <PageHeader title="Add Contractor" subtitle="Register a new contractor to your company." />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Contractor Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Input
                label="Company Name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
                placeholder="e.g. BuildRight Civil Works Ltd"
                error={fieldErrors.name?.[0]}
              />
            </div>
            <Input
              label="Trade / Specialization"
              value={form.tradeSpecialization}
              onChange={(e) => set('tradeSpecialization', e.target.value)}
              placeholder="e.g. Civil & Structural"
              error={fieldErrors.tradeSpecialization?.[0]}
            />
            <Input
              label="Registration Number"
              value={form.registrationNumber}
              onChange={(e) => set('registrationNumber', e.target.value)}
              placeholder="e.g. NCA-2021-1234"
              error={fieldErrors.registrationNumber?.[0]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Contact Information</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Input
                label="Contact Person"
                value={form.contactPerson}
                onChange={(e) => set('contactPerson', e.target.value)}
                placeholder="Name of primary contact"
                error={fieldErrors.contactPerson?.[0]}
              />
            </div>
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
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Link href="/contractors">
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Add Contractor'}
          </Button>
        </div>
      </form>
    </div>
  );
}
