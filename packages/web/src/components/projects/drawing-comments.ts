/**
 * Drawing revision comments — role rules and limits. Mirrors
 * packages/api/src/routes/drawing.routes.ts:
 *   GET  /projects/:projectId/drawings/:drawingId/revisions/:revisionId/comments  VIEW_ROLES
 *   POST /projects/:projectId/drawings/:drawingId/revisions/:revisionId/comments  COMMENT_ROLES
 *   commentSchema: text 1..5000 characters
 * UI only — the API stays the authority; keep these equal, never wider.
 */
import type { UserRole } from '@/lib/types';

export const DRAWING_COMMENT_ROLES = {
  view:    ['company_admin', 'project_manager', 'site_supervisor', 'consultant', 'contractor', 'finance_officer', 'viewer'] as readonly UserRole[],
  comment: ['company_admin', 'project_manager', 'site_supervisor', 'consultant', 'contractor', 'finance_officer'] as readonly UserRole[],
} as const;

export const COMMENT_MAX_LENGTH = 5000;

export const canViewDrawingComments = (role: UserRole | null | undefined) => !!role && DRAWING_COMMENT_ROLES.view.includes(role);
export const canAddDrawingComment   = (role: UserRole | null | undefined) => !!role && DRAWING_COMMENT_ROLES.comment.includes(role);

/** Client-side check matching commentSchema; returns an error message or ''. */
export function commentError(text: string): string {
  const t = text.trim();
  if (!t) return 'Write a comment first';
  if (t.length > COMMENT_MAX_LENGTH) return `Comments can be at most ${COMMENT_MAX_LENGTH} characters`;
  return '';
}
