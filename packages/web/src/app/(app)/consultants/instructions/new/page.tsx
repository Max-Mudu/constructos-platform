'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { instructionApi, projectApi, drawingApi, siteApi, ApiError } from '@/lib/api';
import { Project, JobSite, Drawing } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle, ArrowLeft } from 'lucide-react';

export default function NewInstructionPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const { user }     = useAuthStore();
  const initialProjectId = searchParams.get('projectId') ?? '';

  const [projects, setProjects]   = useState<Project[]>([]);
  const [sites, setSites]         = useState<JobSite[]>([]);
  const [drawings, setDrawings]   = useState<Drawing[]>([]);
  const [projectId, setProjectId] = useState(initialProjectId);

  const [form, setForm] = useState({
    type:             'instruction' as 'instruction' | 'recommendation',
    title:            '',
    category:         '',
    priority:         'medium',
    description:      '',
    issuedDate:       new Date().toISOString().slice(0, 10),
    targetActionDate: '',
    siteId:           '',
    drawingId:        '',
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  useEffect(() => {
    projectApi.list().then((d) => setProjects(d.projects)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!projectId) { setSites([]); setDrawings([]); return; }
    Promise.all([
      siteApi.list(projectId).then((d) => setSites(d.sites)).catch(() => {}),
      drawingApi.list(projectId).then((d) => setDrawings(d.drawings)).catch(() => {}),
    ]);
  }, [projectId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) { setError('Please select a project'); return; }
    setSubmitting(true);
    setError('');
    try {
      const { instruction } = await instructionApi.create(projectId, {
        type:             form.type,
        title:            form.title,
        category:         form.category || undefined,
        priority:         form.priority || undefined,
        description:      form.description || undefined,
        issuedDate:       form.issuedDate,
        targetActionDate: form.targetActionDate || undefined,
        siteId:           form.siteId || undefined,
        drawingId:        form.drawingId || undefined,
      });
      router.push(`/consultants/instructions/${instruction.id}?projectId=${projectId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create instruction');
      setSubmitting(false);
    }
  }

  return (
    <div className="px-6 py-8 max-w-2xl space-y-6 animate-fade-in">
      <PageHeader
        title="New Instruction / Recommendation"
        subtitle="Issue a consultant instruction or recommendation"
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
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Type */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Type *</label>
          <div className="flex gap-3">
            {(['instruction', 'recommendation'] as const).map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="type"
                  value={t}
                  checked={form.type === t}
                  onChange={() => setForm((f) => ({ ...f, type: t }))}
                  className="accent-primary"
                />
                <span className="text-sm capitalize">{t}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Title */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Title *</label>
          <Input
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Brief title of the instruction"
            required
          />
        </div>

        {/* Category */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Category</label>
          <Input
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            placeholder="e.g. Safety, Design, Quality"
          />
        </div>

        {/* Priority */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Priority</label>
          <select
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Description / Details</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="Detailed description of the instruction or recommendation…"
            rows={4}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
        </div>

        {/* Issued Date */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Issued Date *</label>
            <Input
              type="date"
              value={form.issuedDate}
              onChange={(e) => setForm((f) => ({ ...f, issuedDate: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Target Action Date</label>
            <Input
              type="date"
              value={form.targetActionDate}
              onChange={(e) => setForm((f) => ({ ...f, targetActionDate: e.target.value }))}
            />
          </div>
        </div>

        {/* Optional links */}
        {sites.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Site (optional)</label>
            <select
              value={form.siteId}
              onChange={(e) => setForm((f) => ({ ...f, siteId: e.target.value }))}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">— No specific site —</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        {drawings.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Linked Drawing (optional)</label>
            <select
              value={form.drawingId}
              onChange={(e) => setForm((f) => ({ ...f, drawingId: e.target.value }))}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">— No drawing —</option>
              {drawings.map((d) => (
                <option key={d.id} value={d.id}>{d.drawingNumber} — {d.title}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create Instruction'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
