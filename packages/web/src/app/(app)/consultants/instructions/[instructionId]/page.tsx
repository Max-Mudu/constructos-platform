'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { instructionApi, ApiError } from '@/lib/api';
import { ConsultantInstruction } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import {
  AlertCircle, ArrowLeft, CheckCircle2, AlertTriangle,
  Clock, XCircle, Paperclip, Upload,
} from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  open:         'Open',
  acknowledged: 'Acknowledged',
  in_progress:  'In Progress',
  resolved:     'Resolved',
  rejected:     'Rejected',
};

const STATUS_VARIANT: Record<string, 'active' | 'inactive' | 'pending' | 'warning' | 'default'> = {
  open:         'warning',
  acknowledged: 'pending',
  in_progress:  'pending',
  resolved:     'active',
  rejected:     'inactive',
};

const PRIORITY_COLORS: Record<string, string> = {
  low:      'text-muted-foreground',
  medium:   'text-blue-600',
  high:     'text-amber-600',
  critical: 'text-red-600 font-bold',
};

const STATUSES: Array<{ value: string; label: string }> = [
  { value: 'open',         label: 'Open' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'in_progress',  label: 'In Progress' },
  { value: 'resolved',     label: 'Resolved' },
  { value: 'rejected',     label: 'Rejected' },
];

export default function InstructionDetailPage() {
  const { instructionId } = useParams<{ instructionId: string }>();
  const searchParams = useSearchParams();
  const projectId    = searchParams.get('projectId') ?? '';
  const router       = useRouter();
  const { user }     = useAuthStore();

  const [instruction, setInstruction] = useState<ConsultantInstruction | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [response, setResponse]       = useState('');
  const [newStatus, setNewStatus]     = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [saving, setSaving]           = useState(false);
  const [attachFile, setAttachFile]   = useState<File | null>(null);
  const [uploading, setUploading]     = useState(false);

  const canManage     = user?.role === 'company_admin' || user?.role === 'project_manager';
  const isContractor  = user?.role === 'contractor';
  const isSupervisor  = user?.role === 'site_supervisor';
  const isConsultant  = user?.role === 'consultant';
  const canIssue      = canManage || isConsultant;
  const canUpdateStatus = canManage || isSupervisor;
  const canRespond    = isContractor;

  useEffect(() => {
    if (!projectId) return;
    instructionApi.get(projectId, instructionId)
      .then((d) => {
        setInstruction(d.instruction);
        setResponse(d.instruction.contractorResponse ?? '');
        setNewStatus(d.instruction.status);
        setResolutionNotes(d.instruction.resolutionNotes ?? '');
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [instructionId, projectId]);

  async function handleSave() {
    if (!instruction) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (canRespond)      payload['contractorResponse'] = response || null;
      if (canUpdateStatus) payload['status']             = newStatus;
      if (canManage)       payload['resolutionNotes']    = resolutionNotes || null;

      const { instruction: updated } = await instructionApi.update(projectId, instructionId, payload);
      setInstruction(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function handleAttach() {
    if (!attachFile) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', attachFile);
      await instructionApi.uploadAttachment(projectId, instructionId, fd);
      // Reload instruction to show new attachment
      const { instruction: updated } = await instructionApi.get(projectId, instructionId);
      setInstruction(updated);
      setAttachFile(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-6">
        <Skeleton className="h-12 w-96 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (error && !instruction) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!instruction) return null;

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title={instruction.title}
        subtitle={`${instruction.type === 'recommendation' ? 'Recommendation' : 'Instruction'} · ${instruction.issuedBy.firstName} ${instruction.issuedBy.lastName} · ${new Date(instruction.issuedDate).toLocaleDateString()}`}
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

      {/* Main info card */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={STATUS_VARIANT[instruction.status] ?? 'default'}>
              {STATUS_LABELS[instruction.status]}
            </Badge>
            <span className={`text-sm font-medium ${PRIORITY_COLORS[instruction.priority]}`}>
              {instruction.priority.charAt(0).toUpperCase() + instruction.priority.slice(1)} Priority
            </span>
            {instruction.category && (
              <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {instruction.category}
              </span>
            )}
          </div>
        </div>

        {instruction.description && (
          <p className="text-sm text-foreground leading-relaxed">{instruction.description}</p>
        )}

        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Issued by:</span>{' '}
            <span>{instruction.issuedBy.firstName} {instruction.issuedBy.lastName}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Issued date:</span>{' '}
            <span>{new Date(instruction.issuedDate).toLocaleDateString()}</span>
          </div>
          {instruction.targetActionDate && (
            <div>
              <span className="text-muted-foreground">Target date:</span>{' '}
              <span>{new Date(instruction.targetActionDate).toLocaleDateString()}</span>
            </div>
          )}
          {instruction.site && (
            <div>
              <span className="text-muted-foreground">Site:</span>{' '}
              <span>{instruction.site.name}</span>
            </div>
          )}
          {instruction.contractor && (
            <div>
              <span className="text-muted-foreground">Contractor:</span>{' '}
              <span>{instruction.contractor.name}</span>
            </div>
          )}
          {instruction.drawing && (
            <div>
              <span className="text-muted-foreground">Drawing:</span>{' '}
              <span>{instruction.drawing.drawingNumber} — {instruction.drawing.title}</span>
            </div>
          )}
          {instruction.workPackage && (
            <div>
              <span className="text-muted-foreground">Work package:</span>{' '}
              <span>{instruction.workPackage.name}</span>
            </div>
          )}
          {instruction.milestone && (
            <div>
              <span className="text-muted-foreground">Milestone:</span>{' '}
              <span>{instruction.milestone.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Status update */}
      {(canUpdateStatus || canManage) && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 className="font-semibold text-foreground">Update Status</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Status</label>
              <select
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
          {canManage && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Resolution Notes</label>
              <textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                rows={3}
                placeholder="Notes on how this was resolved…"
                className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
          )}
        </div>
      )}

      {/* Contractor response */}
      {(canRespond || instruction.contractorResponse) && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-3">
          <h3 className="font-semibold text-foreground">Contractor Response</h3>
          {canRespond ? (
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              rows={3}
              placeholder="Your response to this instruction…"
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          ) : (
            <p className="text-sm text-foreground">
              {instruction.contractorResponse ?? <span className="text-muted-foreground">No response yet</span>}
            </p>
          )}
        </div>
      )}

      {/* Resolution notes (display for non-managers) */}
      {!canManage && instruction.resolutionNotes && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-2">
          <h3 className="font-semibold text-foreground">Resolution Notes</h3>
          <p className="text-sm text-foreground">{instruction.resolutionNotes}</p>
        </div>
      )}

      {/* Save button */}
      {(canUpdateStatus || canManage || canRespond) && (
        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      )}

      {/* Attachments */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Paperclip className="h-4 w-4" /> Attachments
          </h3>
          <span className="text-xs text-muted-foreground">{instruction.attachments.length}</span>
        </div>
        {instruction.attachments.length > 0 ? (
          <div className="space-y-2">
            {instruction.attachments.map((att) => (
              <a
                key={att.id}
                href={att.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <Paperclip className="h-3.5 w-3.5" />
                {att.fileName}
                <span className="text-xs text-muted-foreground">({(att.fileSizeBytes / 1024).toFixed(1)} KB)</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No attachments</p>
        )}

        {canIssue && (
          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <input
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx"
              onChange={(e) => setAttachFile(e.target.files?.[0] ?? null)}
              className="text-xs text-muted-foreground"
            />
            <Button
              onClick={handleAttach}
              disabled={!attachFile || uploading}
              variant="outline"
              className="text-xs h-8"
            >
              <Upload className="h-3.5 w-3.5 mr-1" />
              {uploading ? 'Uploading…' : 'Upload'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
