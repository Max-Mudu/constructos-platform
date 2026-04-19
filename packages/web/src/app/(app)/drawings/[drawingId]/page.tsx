'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { drawingApi, ApiError } from '@/lib/api';
import { Drawing, DrawingRevision, DrawingComment } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { PageHeader } from '@/components/ui/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import {
  FileStack, AlertCircle, ArrowLeft, Plus, CheckCircle2,
  Clock, FileText, MessageSquare, Download, Star,
} from 'lucide-react';

const STATUS_LABELS: Record<string, string> = {
  draft:                   'Draft',
  issued_for_review:       'Issued for Review',
  issued_for_construction: 'Issued for Construction',
  superseded:              'Superseded',
  archived:                'Archived',
};

const STATUS_VARIANT: Record<string, 'active' | 'inactive' | 'pending' | 'warning' | 'default'> = {
  draft:                   'pending',
  issued_for_review:       'warning',
  issued_for_construction: 'active',
  superseded:              'inactive',
  archived:                'inactive',
};

function RevisionCard({
  revision,
  isCurrent,
  canApprove,
  onApprove,
  drawingId,
  projectId,
}: {
  revision: DrawingRevision;
  isCurrent: boolean;
  canApprove: boolean;
  onApprove: (revisionId: string) => void;
  drawingId: string;
  projectId: string;
}) {
  return (
    <div className={`rounded-xl border p-4 space-y-3 ${isCurrent ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border bg-card'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {isCurrent && (
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600">
              <Star className="h-3.5 w-3.5 fill-emerald-600" /> Current
            </span>
          )}
          <span className="font-mono font-semibold text-sm text-foreground">Rev {revision.revisionNumber}</span>
          <Badge variant={STATUS_VARIANT[revision.status] ?? 'default'}>
            {STATUS_LABELS[revision.status] ?? revision.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={revision.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <Download className="h-3.5 w-3.5" /> Download
          </a>
          {canApprove && revision.status !== 'issued_for_construction' && (
            <Button
              variant="outline"
              onClick={() => onApprove(revision.id)}
              className="text-xs h-7 px-2"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Approve
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>File: {revision.fileName}</span>
        <span>Size: {(revision.fileSizeBytes / 1024).toFixed(1)} KB</span>
        <span>Uploaded: {new Date(revision.createdAt).toLocaleDateString()}</span>
        {revision.issueDate && <span>Issue date: {new Date(revision.issueDate).toLocaleDateString()}</span>}
        {revision.approvedBy && (
          <span>Approved by: {revision.approvedBy.firstName} {revision.approvedBy.lastName}</span>
        )}
        {revision.approvedAt && (
          <span>Approved: {new Date(revision.approvedAt).toLocaleDateString()}</span>
        )}
      </div>
      {revision.notes && (
        <p className="text-xs text-muted-foreground border-t border-border pt-2">{revision.notes}</p>
      )}
      {/* Comments link */}
      <Link
        href={`/drawings/${drawingId}/revisions/${revision.id}/comments?projectId=${projectId}`}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
      >
        <MessageSquare className="h-3.5 w-3.5" /> View / add comments
      </Link>
    </div>
  );
}

export default function DrawingDetailPage() {
  const { drawingId } = useParams<{ drawingId: string }>();
  const searchParams  = useSearchParams();
  const projectId     = searchParams.get('projectId') ?? '';
  const router        = useRouter();
  const { user }      = useAuthStore();

  const [drawing, setDrawing]   = useState<Drawing | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [approving, setApproving] = useState(false);

  const canManage = user?.role === 'company_admin' || user?.role === 'project_manager';

  useEffect(() => {
    if (!projectId) return;
    drawingApi.get(projectId, drawingId)
      .then((d) => setDrawing(d.drawing))
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load drawing'))
      .finally(() => setLoading(false));
  }, [drawingId, projectId]);

  async function handleApprove(revisionId: string) {
    if (!projectId || !drawing) return;
    setApproving(true);
    try {
      await drawingApi.approveRevision(projectId, drawingId, revisionId, {});
      const { drawing: updated } = await drawingApi.get(projectId, drawingId);
      setDrawing(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve');
    } finally {
      setApproving(false);
    }
  }

  if (loading) {
    return (
      <div className="px-6 py-8 space-y-6">
        <Skeleton className="h-12 w-96 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-60 rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 py-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!drawing) return null;

  const currentRevision = drawing.revisions.find((r) => r.id === drawing.currentRevisionId);

  return (
    <div className="px-6 py-8 space-y-6 animate-fade-in">
      <PageHeader
        title={drawing.title}
        subtitle={`Drawing ${drawing.drawingNumber}${drawing.discipline ? ` · ${drawing.discipline}` : ''}${drawing.site ? ` · ${drawing.site.name}` : ''}`}
        action={
          canManage ? (
            <Link href={`/drawings/${drawingId}/revisions/new?projectId=${projectId}`}>
              <Button><Plus className="h-4 w-4 mr-1" /> Upload Revision</Button>
            </Link>
          ) : undefined
        }
      />

      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Drawings
      </button>

      {/* Summary card */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          <FileStack className="h-5 w-5 text-primary" />
          <span className="font-semibold text-foreground">Drawing Info</span>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div>
            <span className="text-muted-foreground">Number:</span>{' '}
            <span className="font-mono font-medium">{drawing.drawingNumber}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Discipline:</span>{' '}
            <span>{drawing.discipline ?? '—'}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Revisions:</span>{' '}
            <span>{drawing.revisions.length}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Created by:</span>{' '}
            <span>{drawing.createdBy.firstName} {drawing.createdBy.lastName}</span>
          </div>
          {currentRevision && (
            <div className="col-span-2 flex items-center gap-2">
              <span className="text-muted-foreground">Current revision:</span>
              <span className="font-mono font-medium">Rev {currentRevision.revisionNumber}</span>
              <Badge variant={STATUS_VARIANT[currentRevision.status] ?? 'default'}>
                {STATUS_LABELS[currentRevision.status]}
              </Badge>
              {currentRevision.status === 'issued_for_construction' && (
                <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approved for construction
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {approving && (
        <Alert>
          <Clock className="h-4 w-4" />
          <AlertDescription>Approving revision…</AlertDescription>
        </Alert>
      )}

      {/* Revision history */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Revision History</h2>
          <span className="text-xs text-muted-foreground">{drawing.revisions.length} revision{drawing.revisions.length !== 1 ? 's' : ''}</span>
        </div>
        {drawing.revisions.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No revisions uploaded yet.</p>
            {canManage && (
              <Link href={`/drawings/${drawingId}/revisions/new?projectId=${projectId}`}>
                <Button className="mt-3" variant="outline">Upload First Revision</Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {drawing.revisions.map((rev) => (
              <RevisionCard
                key={rev.id}
                revision={rev}
                isCurrent={rev.id === drawing.currentRevisionId}
                canApprove={canManage}
                onApprove={handleApprove}
                drawingId={drawingId}
                projectId={projectId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
