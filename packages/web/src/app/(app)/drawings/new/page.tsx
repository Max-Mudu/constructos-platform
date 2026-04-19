'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { drawingApi, projectApi, siteApi, ApiError } from '@/lib/api';
import { Project, JobSite } from '@/lib/types';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle, ArrowLeft } from 'lucide-react';

export default function NewDrawingPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const initialProjectId = searchParams.get('projectId') ?? '';

  const [projects, setProjects]   = useState<Project[]>([]);
  const [sites, setSites]         = useState<JobSite[]>([]);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [form, setForm] = useState({
    drawingNumber: '',
    title:         '',
    discipline:    '',
    siteId:        '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    projectApi.list().then((d) => setProjects(d.projects)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectId) { setSites([]); return; }
    siteApi.list(projectId).then((d) => setSites(d.sites)).catch(() => {});
  }, [projectId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) { setError('Please select a project'); return; }
    setSubmitting(true);
    setError('');
    try {
      const { drawing } = await drawingApi.create(projectId, {
        drawingNumber: form.drawingNumber,
        title:         form.title,
        discipline:    form.discipline || undefined,
        siteId:        form.siteId || undefined,
      });
      router.push(`/drawings/${drawing.id}?projectId=${projectId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create drawing');
      setSubmitting(false);
    }
  }

  return (
    <div className="px-6 py-8 max-w-2xl space-y-6 animate-fade-in">
      <PageHeader
        title="New Drawing"
        subtitle="Register a new drawing to the project"
      />

      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Project */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Project *</label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Select project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Drawing Number */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Drawing Number *</label>
          <Input
            value={form.drawingNumber}
            onChange={(e) => setForm((f) => ({ ...f, drawingNumber: e.target.value }))}
            placeholder="e.g. A-001, S-101"
            required
          />
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Title *</label>
          <Input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Ground Floor Plan"
            required
          />
        </div>

        {/* Discipline */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Discipline</label>
          <Input
            value={form.discipline}
            onChange={(e) => setForm((f) => ({ ...f, discipline: e.target.value }))}
            placeholder="e.g. Architectural, Structural, MEP"
          />
        </div>

        {/* Site (optional) */}
        {sites.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Site (optional)</label>
            <select
              value={form.siteId}
              onChange={(e) => setForm((f) => ({ ...f, siteId: e.target.value }))}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">All sites / project-level</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Drawing'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
