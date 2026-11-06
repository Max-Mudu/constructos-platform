/**
 * Who may see and change a site's assigned workers. Mirrors
 * packages/api/src/routes/worker.routes.ts (siteWorkerRoutes):
 *   GET    /projects/:projectId/sites/:siteId/workers            VIEW_ROLES
 *   POST   /projects/:projectId/sites/:siteId/workers            ASSIGN_ROLES
 *   DELETE /projects/:projectId/sites/:siteId/workers/:workerId  ASSIGN_ROLES
 *
 * Any project member can open the site page, so without this check a
 * contractor, consultant or viewer triggered a 403 (and a permission_denied
 * audit entry) on every visit, which the page then hid as "No workers".
 * UI only — the API stays the authority; keep these equal, never wider.
 */
import type { UserRole } from '@/lib/types';

export const SITE_WORKER_ROLES = {
  view:   ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer'] as readonly UserRole[],
  assign: ['company_admin', 'project_manager'] as readonly UserRole[],
} as const;

export const canViewSiteWorkers   = (role: UserRole | null | undefined) => !!role && SITE_WORKER_ROLES.view.includes(role);
export const canAssignSiteWorkers = (role: UserRole | null | undefined) => !!role && SITE_WORKER_ROLES.assign.includes(role);
