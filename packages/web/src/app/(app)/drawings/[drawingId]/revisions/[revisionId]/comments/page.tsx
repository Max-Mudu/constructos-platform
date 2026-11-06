'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { drawingApi, ApiError } from '@/lib/api';
import type { Drawing, DrawingComment } from '@/lib/types';
import { useAuthStore } from '@/store/auth.store';
import { roleLabel } from '@/lib/team-roles';
import {
  COMMENT_MAX_LENGTH, canAddDrawingComment, canViewDrawingComments, commentError,
} from '@/components/projects/drawing-comments';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Alert, AlertDescription } from '@/components/ui/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Separator } from '@/components/ui/Separator';
import { AlertCircle, ArrowLeft, MessageSquare } from 'lucide-react';

export default function RevisionCommentsPage() {
  const { drawingId, revisionId } = useParams<{ drawingId: string; revisionId: string }>()!;
  const projectId = useSearchParams()!.get('projectId') ?? '';
  const role = useAuthStore((s) => s.user?.role);
  const canView = canViewDrawingComments(role);
  const canComment = canAddDrawingComment(role);
  const drawingHref = projectId
    ? `/drawings/${drawingId}?projectId=${encodeURIComponent(projectId)}`
    : '/drawings';

  const [drawing, setDrawing]   = useState<Drawing | null>(null);
  const [comments, setComments] = useState<DrawingComment[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [text, setText]         = useState('');
  const [posting, setPosting]   = useState(false);
  const [postError, setPostError] = useState('');

  useEffect(() => {
    if (!projectId) {
      setError('This comments link is missing its project. Open the drawing from the Drawings list.');
      setLoading(false);
      return;
    }
    if (!canView) { setLoading(false); return; }
    Promise.all([
      drawingApi.get(projectId, drawingId),
      drawingApi.listComments(projectId, drawingId, revisionId),
    ])
      .then(([d, c]) => { setDrawing(d.drawing); setComments(c.comments); })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to load comments'))
      .finally(() => setLoading(false));
  }, [projectId, drawingId, revisionId, canView]);

  async function handlePost() {
    const problem = commentError(text);
    if (problem) { setPostError(problem); return; }
    setPosting(true);
    setPostError('');
    try {
      const { comment } = await drawingApi.addComment(projectId, drawingId, revisionId, text.trim());
      setComments((prev) => [...prev, comment]);
      setText('');
    } catch (e) {
      if (e instanceof ApiError) {
        const detail = e.details?.text?.[0];
        setPostError(detail ?? e.message ?? 'Failed to add comment');
      } else {
        setPostError('Failed to add comment');
      }
    } finally {
      setPosting(false);
    }
  }

  const revision = drawing?.revisions.find((r) => r.id === revisionId);
  const title = drawing
    ? `${drawing.drawingNumber}${revision ? ` · Rev ${revision.revisionNumber}` : ''}`
    : 'Revision comments';

  return (
    <div className="px-6 py-8 max-w-3xl space-y-6 animate-fade-in">
      <PageHeader
        title="Revision Comments"
        subtitle={drawing ? `${drawing.title} — ${title}` : undefined}
      />

      <Link
        href={drawingHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> {projectId ? 'Back to Drawing' : 'Back to Drawings'}
      </Link>

      {!canView ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Your role cannot view drawing comments.</AlertDescription>
        </Alert>
      ) : loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : drawing && !revision ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>This revision does not belong to the drawing.</AlertDescription>
        </Alert>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                {comments.length} comment{comments.length !== 1 ? 's' : ''}
              </CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="pt-3">
              {comments.length === 0 ? (
                <p className="py-1 text-sm text-muted-foreground">No comments on this revision yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {comments.map((c) => (
                    <li key={c.id} className="py-3 space-y-1">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{c.user.firstName} {c.user.lastName}</span>
                        {' · '}{roleLabel(c.user.role)}
                        {' · '}{new Date(c.createdAt).toLocaleString()}
                      </p>
                      <p className="whitespace-pre-wrap text-sm text-foreground">{c.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {canComment ? (
            <Card>
              <CardHeader><CardTitle className="text-base">Add a comment</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {postError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{postError}</AlertDescription>
                  </Alert>
                )}
                <textarea
                  aria-label="Comment"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  maxLength={COMMENT_MAX_LENGTH}
                  placeholder="Note a clash, a query or a required change…"
                  className="w-full rounded-lg border border-border bg-navy-base px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground resize-y focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{text.length}/{COMMENT_MAX_LENGTH}</span>
                  <Button onClick={() => void handlePost()} disabled={posting || !text.trim()}>
                    {posting ? 'Posting…' : 'Post Comment'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">Your role can read comments but not add them.</p>
          )}
        </>
      )}
    </div>
  );
}
