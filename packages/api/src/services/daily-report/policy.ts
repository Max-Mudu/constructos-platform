import { UserRole } from '@prisma/client';

/**
 * Who may do what with daily reports. Route preHandlers and file access both
 * import these so they cannot drift. Contractors, workers and super_admin are
 * excluded in V1. Consultants read only (owner decision 2026-11-06).
 */
export const DAILY_REPORT_VIEW_ROLES: readonly UserRole[] = [
  'company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'viewer', 'consultant',
];

/**
 * Roles whose project membership's siteId limits them to that one site for
 * daily reports (a null siteId means the whole project). Daily Report only:
 * the platform-wide getAccessibleSiteIds still scopes supervisors alone.
 * Project managers are deliberately absent: C1 user creation stores a default
 * site on every membership, and PMs keep project-wide access.
 */
export const DAILY_REPORT_SITE_SCOPED_ROLES: readonly UserRole[] = [
  'site_supervisor', 'viewer', 'consultant',
];

/** Create, edit, attach photos, run AI extraction, finalise. */
export const DAILY_REPORT_EDIT_ROLES: readonly UserRole[] = [
  'company_admin', 'project_manager', 'site_supervisor',
];

/** Reopen a finalised report for correction. */
export const DAILY_REPORT_REOPEN_ROLES: readonly UserRole[] = [
  'company_admin', 'project_manager',
];

/** rawInput and aiDraft are returned only to editors. */
export const canSeeDraftInputs = (role: UserRole): boolean => DAILY_REPORT_EDIT_ROLES.includes(role);
