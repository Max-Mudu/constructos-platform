'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { scheduleApi, contractorApi, ApiError } from '@/lib/api';
import { Contractor, WorkPackage } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';
import { AlertCircle } from 'lucide-react';

export default function NewScheduleTaskPage() {
  const router = useRouter();
  const { projectId, siteId } = useParams<{ projectId: string; siteId: string }>();

  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [packages,    setPackages]    = useState<WorkPackage[]>([]);

  const [form, setForm] = useState({
    contractorId: '', workPackageId: '',
    title: '', description: '', area: '',
    materialsRequired: '', equipmentRequired: '',
    plannedStartDate: '', plannedEndDate: '',
    plannedProgress: '0',
  });
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  function set(k: string, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  useEffect(() => {
    if (!projectId || !siteId) return;
    Promise.all([
      contractorApi.list({ isActive: true }),
      scheduleApi.listPackages(projectId, siteId),
    ])
      .then(([c, p]) => { setContractors(c.contractors); setPackages(p.packages); })
      .catch(() => {});
  }, [projectId, siteId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId || !siteId) return;
    setSubmitting(true);
    setError('');
    setFieldErrors({});
    try {
      const payload: Parameters<typeof scheduleApi.createTask>[2] = {
        contractorId: form.contractorId,
        title:        form.title,
      };
      if (form.workPackageId)     payload.workPackageId      = form.workPackageId;
      if (form.description)       payload.description        = form.description;
      if (form.area)              payload.area               = form.area;
      if (form.materialsRequired) payload.materialsRequired  = form.materialsRequired;
      if (form.equipmentRequired) payload.equipmentRequired  = form.equipmentRequired;
      if (form.plannedStartDate)  payload.plannedStartDate   = form.plannedStartDate;
      if (form.plannedEndDate)    payload.plannedEndDate     = form.plannedEndDate;
      if (form.plannedProgress)   payload.plannedProgress    = Number(form.plannedProgress);

      const { task } = await scheduleApi.createTask(projectId, siteId, payload);
      router.push(`/projects/${projectId}/sites/${siteId}/schedules/${task.id}`);
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
        { label: 'Site', href: `/projects/${projectId}/sites/${siteId}` },
        { label: 'Schedule', href: `/projects/${projectId}/sites/${siteId}/schedules` },
        { label: 'New Task' },
      ]} />
      <PageHeader title="Add Schedule Task" subtitle="Create a new task for contractor tracking." />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Assignment</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Select
                label="Contractor"
                value={form.contractorId}
                onChange={(e) => set('contractorId', e.target.value)}
                required
                error={fieldErrors.contractorId?.[0]}
              >
                <option value="">Select contractor…</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            {packages.length > 0 && (
              <div className="col-span-2">
                <Select
                  label="Work Package (optional)"
                  value={form.workPackageId}
                  onChange={(e) => set('workPackageId', e.target.value)}
                >
                  <option value="">No package — standalone task</option>
                  {packages.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Task Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Task Title"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              required
              placeholder="e.g. Pour Concrete Foundation Slab"
              error={fieldErrors.title?.[0]}
            />
            <Input
              label="Area / Zone / Block / Floor"
              value={form.area}
              onChange={(e) => set('area', e.target.value)}
              placeholder="e.g. Zone A — Ground Floor"
              error={fieldErrors.area?.[0]}
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={3}
                placeholder="Describe the scope of work…"
                className={cn(
                  'flex w-full rounded-lg border border-border bg-navy-base px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground',
                  'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none',
                )}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Resources</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Materials Required
              </label>
              <textarea
                value={form.materialsRequired}
                onChange={(e) => set('materialsRequired', e.target.value)}
                rows={2}
                placeholder="List materials needed…"
                className={cn(
                  'flex w-full rounded-lg border border-border bg-navy-base px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground',
                  'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none',
                )}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">
                Equipment Required
              </label>
              <textarea
                value={form.equipmentRequired}
                onChange={(e) => set('equipmentRequired', e.target.value)}
                rows={2}
                placeholder="List equipment needed…"
                className={cn(
                  'flex w-full rounded-lg border border-border bg-navy-base px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground',
                  'transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none',
                )}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Schedule</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <Input
              label="Planned Start"
              type="date"
              value={form.plannedStartDate}
              onChange={(e) => set('plannedStartDate', e.target.value)}
              error={fieldErrors.plannedStartDate?.[0]}
            />
            <Input
              label="Planned End"
              type="date"
              value={form.plannedEndDate}
              onChange={(e) => set('plannedEndDate', e.target.value)}
              error={fieldErrors.plannedEndDate?.[0]}
            />
            <div className="col-span-2">
              <Input
                label="Planned Progress (%)"
                type="number"
                value={form.plannedProgress}
                onChange={(e) => set('plannedProgress', e.target.value)}
                placeholder="0"
                error={fieldErrors.plannedProgress?.[0]}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-3 justify-end">
          <Link href={`/projects/${projectId}/sites/${siteId}/schedules`}>
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Create Task'}
          </Button>
        </div>
      </form>
    </div>
  );
}
