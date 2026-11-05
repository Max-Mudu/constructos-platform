import { UserRole } from '@prisma/client';

/**
 * Who may do what with daily reports. Route preHandlers and file access both
 * import these so they cannot drift. Contractors, consultants, workers and
 * super_admin are excluded in V1.
 */
export const DAILY_REPORT_VIEW_ROLES: readonly UserRole[] = [
  'company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'viewer',
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
