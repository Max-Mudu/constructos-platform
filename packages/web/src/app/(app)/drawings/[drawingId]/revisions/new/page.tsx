'use client';

import { useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { drawingApi, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { AlertCircle, ArrowLeft, Upload } from 'lucide-react';

const STATUS_OPTIONS = [
  { value: 'draft',                   label: 'Draft' },
  { value: 'issued_for_review',       label: 'Issued for Review' },
  { value: 'issued_for_construction', label: 'Issued for Construction' },
  { value: 'archived',                label: 'Archived' },
];

export default function UploadRevisionPage() {
  const { drawingId } = useParams<{ drawingId: string }>();
  const searchParams  = useSearchParams();
  const projectId     = searchParams.get('projectId') ?? '';
  const router        = useRouter();

  const [file, setFile]         = useState<File | null>(null);
  const [form, setForm]         = useState({
    revisionNumber: '',
    status:         'draft',
    issueDate:      '',
    notes:          '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) { setError('Please select a file'); return; }
    setSubmitting(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('revisionNumber', form.revisionNumber);
      fd.append('status', form.status);
      if (form.issueDate) fd.append('issueDate', form.issueDate);
      if (form.notes)     fd.append('notes', form.notes);

      await drawingApi.uploadRevision(projectId, drawingId, fd);
      router.push(`/drawings/${drawingId}?projectId=${projectId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
      setSubmitting(false);
    }
  }

  return (
    <div className="px-6 py-8 max-w-2xl space-y-6 animate-fade-in">
      <PageHeader
        title="Upload Revision"
        subtitle="Upload a new drawing revision file"
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
        {/* File upload */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Drawing File *</label>
          <div className="rounded-xl border-2 border-dashed border-border p-6 text-center hover:border-primary/50 transition-colors">
            <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground mb-2">
              {file ? file.name : 'Drag and drop or click to select'}
            </p>
            <p className="text-xs text-muted-foreground">PDF, DWG (via PDF), PNG, JPEG — max 20 MB</p>
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-3 text-xs text-muted-foreground"
              required
            />
          </div>
        </div>

        {/* Revision number */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Revision Number *</label>
          <Input
            value={form.revisionNumber}
            onChange={(e) => setForm((f) => ({ ...f, revisionNumber: e.target.value }))}
            placeholder="e.g. A, B, C, 01, Rev1"
            required
          />
        </div>

        {/* Status */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Status *</label>
          <select
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            required
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Issue date */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Issue Date</label>
          <Input
            type="date"
            value={form.issueDate}
            onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))}
          />
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Optional notes about this revision…"
            rows={3}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Uploading…' : 'Upload Revision'}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
