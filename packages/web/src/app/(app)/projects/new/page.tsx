'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { projectApi, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';

export default function NewProjectPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    name: '',
    code: '',
    description: '',
    location: '',
    startDate: '',
    endDate: '',
    status: 'active',
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
      const payload: Parameters<typeof projectApi.create>[0] = {
        name: form.name,
      };
      if (form.code)        payload.code        = form.code;
      if (form.description) payload.description = form.description;
      if (form.location)    payload.location    = form.location;

      const { project } = await projectApi.create(payload);
      router.push(`/projects/${project.id}`);
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
      <Breadcrumb items={[{ label: 'Projects', href: '/projects' }, { label: 'New Project' }]} />
      <PageHeader title="New Project" subtitle="Create a new construction project." />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic info */}
        <Card>
          <CardHeader><CardTitle className="text-base">Project Details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Input
                label="Project Name"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
                placeholder="e.g. Westlands Office Block"
                error={fieldErrors.name?.[0]}
              />
            </div>
            <Input
              label="Project Code"
              value={form.code}
              onChange={(e) => set('code', e.target.value)}
              placeholder="e.g. PRJ-001"
              error={fieldErrors.code?.[0]}
            />
            <Select
              label="Status"
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
            >
              <option value="active">Active</option>
              <option value="on_hold">On Hold</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
            <div className="col-span-2">
              <Input
                label="Location"
                value={form.location}
                onChange={(e) => set('location', e.target.value)}
                placeholder="e.g. Westlands, Nairobi"
                error={fieldErrors.location?.[0]}
              />
            </div>
            <Input
              label="Start Date"
              type="date"
              value={form.startDate}
              onChange={(e) => set('startDate', e.target.value)}
              error={fieldErrors.startDate?.[0]}
            />
            <Input
              label="End Date"
              type="date"
              value={form.endDate}
              onChange={(e) => set('endDate', e.target.value)}
              error={fieldErrors.endDate?.[0]}
            />
          </CardContent>
        </Card>

        {/* Description */}
        <Card>
          <CardHeader><CardTitle className="text-base">Description</CardTitle></CardHeader>
          <CardContent>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              placeholder="Optional project description…"
              className={cn(
                'flex w-full rounded-lg border border-border bg-navy-base px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground',
                'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                'disabled:cursor-not-allowed disabled:opacity-50 resize-none',
              )}
            />
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Link href="/projects">
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Project'}
          </Button>
        </div>
      </form>
    </div>
  );
}
