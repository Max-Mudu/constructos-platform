'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { contractorApi, ApiError } from '@/lib/api';
import type { Contractor } from '@/lib/types';
import { formErrorState } from '@/lib/workflows-form-errors';
import { useAuthStore } from '@/store/auth.store';
import {
  canManageContractors, contractorFormErrors, contractorToForm, contractorUpdatePayload,
  type ContractorFormValues,
} from '../../contractor-form';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { AlertCircle } from 'lucide-react';

const INLINE = ['name', 'contactPerson', 'email', 'phone', 'registrationNumber', 'tradeSpecialization', 'isActive'];

export default function EditContractorPage() {
  const { contractorId } = useParams<{ contractorId: string }>()!;
  const router = useRouter();
  const allowed = canManageContractors(useAuthStore((s) => s.user?.role));
  const detailHref = `/contractors/${contractorId}`;

  const [contractor, setContractor]   = useState<Contractor | null>(null);
  const [form, setForm]               = useState<ContractorFormValues | null>(null);
  const [loading, setLoading]         = useState(true);
  const [loadError, setLoadError]     = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!contractorId || !allowed) { setLoading(false); return; }
    contractorApi.get(contractorId)
      .then(({ contractor: c }) => { setContractor(c); setForm(contractorToForm(c)); })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : 'Failed to load contractor'))
      .finally(() => setLoading(false));
  }, [contractorId, allowed]);

  function set<K extends keyof ContractorFormValues>(k: K, v: ContractorFormValues[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!contractor || !form) return;
    const local = contractorFormErrors(form);
    if (Object.keys(local).length > 0) { setFieldErrors(local); setError(''); return; }

    const payload = contractorUpdatePayload(contractor, form);
    if (Object.keys(payload).length === 0) { router.push(detailHref); return; }

    setSubmitting(true);
    setError('');
    setFieldErrors({});
    try {
      await contractorApi.update(contractorId, payload);
      router.push(detailHref);
    } catch (err) {
      const state = formErrorState(err, INLINE, 'Failed to save contractor');
      setFieldErrors(state.fieldErrors);
      setError(state.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="px-6 py-8 max-w-2xl space-y-6 animate-fade-in">
      <Breadcrumb items={[
        { label: 'Contractors', href: '/contractors' },
        { label: contractor?.name ?? 'Contractor', href: detailHref },
        { label: 'Edit' },
      ]} />
      <PageHeader title="Edit Contractor" subtitle={contractor?.name} />

      {!allowed || loadError || (!loading && !form) ? (
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {!allowed
                ? 'Only a company admin or project manager can edit contractors.'
                : loadError || 'Contractor not found'}
            </AlertDescription>
          </Alert>
          <Link href={allowed ? '/contractors' : detailHref}>
            <Button variant="outline" size="sm">{allowed ? 'Back to Contractors' : 'Back to Contractor'}</Button>
          </Link>
        </div>
      ) : loading || !form ? (
        <Skeleton className="h-72 rounded-xl" />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader><CardTitle className="text-base">Contractor Details</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input
                  label="Company Name"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  required
                  maxLength={200}
                  error={fieldErrors.name?.[0]}
                />
              </div>
              <Input
                label="Trade / Specialization"
                value={form.tradeSpecialization}
                onChange={(e) => set('tradeSpecialization', e.target.value)}
                maxLength={200}
                error={fieldErrors.tradeSpecialization?.[0]}
              />
              <Input
                label="Registration Number"
                value={form.registrationNumber}
                onChange={(e) => set('registrationNumber', e.target.value)}
                maxLength={100}
                error={fieldErrors.registrationNumber?.[0]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Contact Information</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input
                  label="Contact Person"
                  value={form.contactPerson}
                  onChange={(e) => set('contactPerson', e.target.value)}
                  maxLength={200}
                  error={fieldErrors.contactPerson?.[0]}
                />
              </div>
              <Input
                label="Email"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                maxLength={200}
                error={fieldErrors.email?.[0]}
              />
              <Input
                label="Phone"
                type="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                maxLength={50}
                error={fieldErrors.phone?.[0]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5 space-y-1">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => set('isActive', e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Contractor is active
              </label>
              <p className="text-xs text-muted-foreground">
                Deactivating keeps the contractor&apos;s history; you can reactivate them here later.
              </p>
            </CardContent>
          </Card>

          <div className="flex gap-3 justify-end">
            <Link href={detailHref}>
              <Button type="button" variant="outline">Cancel</Button>
            </Link>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
