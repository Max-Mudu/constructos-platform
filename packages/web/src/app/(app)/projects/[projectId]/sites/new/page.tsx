'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { siteApi, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { AlertCircle } from 'lucide-react';

export default function NewSitePage() {
  const router = useRouter();
  const { projectId } = useParams<{ projectId: string }>();

  const [form, setForm] = useState({ name: '', address: '' });
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    setSubmitting(true);
    setError('');
    setFieldErrors({});

    try {
      const payload: { name: string; address?: string } = { name: form.name };
      if (form.address) payload.address = form.address;

      const { site } = await siteApi.create(projectId, payload);
      router.push(`/projects/${projectId}/sites/${site.id}`);
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
      <Breadcrumb items={[
        { label: 'Projects', href: '/projects' },
        { label: 'Project', href: `/projects/${projectId}` },
        { label: 'New Site' },
      ]} />
      <PageHeader title="Add Job Site" subtitle="Add a new job site to this project." />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Site Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Site Name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
              placeholder="e.g. Block A Foundation"
              error={fieldErrors.name?.[0]}
            />
            <Input
              label="Address"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="e.g. Westlands, Nairobi"
              error={fieldErrors.address?.[0]}
            />
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Link href={`/projects/${projectId}`}>
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Adding…' : 'Add Site'}
          </Button>
        </div>
      </form>
    </div>
  );
}
