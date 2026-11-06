/**
 * Team management — roles, validation and error wording.
 *
 * The server is the authority (packages/api/src/services/user.service.ts and
 * the zod schema in company.routes.ts). This module mirrors those rules so the
 * form can explain a problem before the round trip; any drift is caught by the
 * server returning 422, which the page still shows.
 */
import type { UserRole } from '@/lib/types';

/** Mirror of ASSIGNABLE_USER_ROLES (api user.service). Never super_admin or worker. */
export const ASSIGNABLE_TEAM_ROLES = [
  'company_admin',
  'finance_officer',
  'project_manager',
  'site_supervisor',
  'contractor',
  'consultant',
  'viewer',
] as const satisfies readonly UserRole[];

export type AssignableTeamRole = (typeof ASSIGNABLE_TEAM_ROLES)[number];

/** Roles that reach every project in the company; project and site are optional. */
export const COMPANY_WIDE_TEAM_ROLES: readonly UserRole[] = ['company_admin', 'finance_officer'];

export const CONSULTANT_TYPES = ['engineer', 'architect', 'quantity_surveyor', 'other'] as const;
export type ConsultantType = (typeof CONSULTANT_TYPES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin:     'Super admin',
  company_admin:   'Company admin',
  finance_officer: 'Finance officer',
  project_manager: 'Project manager',
  site_supervisor: 'Site supervisor',
  contractor:      'Contractor',
  consultant:      'Consultant',
  worker:          'Worker',
  viewer:          'Viewer',
};

export const CONSULTANT_TYPE_LABELS: Record<ConsultantType, string> = {
  engineer:          'Engineer',
  architect:         'Architect',
  quantity_surveyor: 'Quantity surveyor',
  other:             'Other',
};

export function roleLabel(role: string): string {
  return (ROLE_LABELS as Record<string, string>)[role] ?? role.replace(/_/g, ' ');
}

export function isAssignableRole(role: string): role is AssignableTeamRole {
  return (ASSIGNABLE_TEAM_ROLES as readonly string[]).includes(role);
}

export function isCompanyWideRole(role: string): boolean {
  return (COMPANY_WIDE_TEAM_ROLES as readonly string[]).includes(role);
}

/** UX gate only — the API enforces company_admin on every team endpoint. */
export function canManageTeam(role: UserRole | null | undefined): boolean {
  return role === 'company_admin';
}

// ─── Form ────────────────────────────────────────────────────────────────────

export interface NewMemberForm {
  email:          string;
  firstName:      string;
  lastName:       string;
  phone:          string;
  role:           AssignableTeamRole | '';
  consultantType: ConsultantType | '';
  projectId:      string;
  siteId:         string;
}

export const EMPTY_MEMBER_FORM: NewMemberForm = {
  email: '', firstName: '', lastName: '', phone: '',
  role: '', consultantType: '', projectId: '', siteId: '',
};

export type MemberFormErrors = Partial<Record<keyof NewMemberForm, string>>;

// Deliberately loose; the server's z.string().email() is the real check.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateMemberForm(form: NewMemberForm): MemberFormErrors {
  const errors: MemberFormErrors = {};
  const email = form.email.trim();

  if (!email) errors.email = 'Email is required';
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address';

  if (!form.firstName.trim()) errors.firstName = 'First name is required';
  else if (form.firstName.trim().length > 100) errors.firstName = 'First name must be 100 characters or fewer';

  if (!form.lastName.trim()) errors.lastName = 'Last name is required';
  else if (form.lastName.trim().length > 100) errors.lastName = 'Last name must be 100 characters or fewer';

  if (form.phone.trim().length > 30) errors.phone = 'Phone must be 30 characters or fewer';

  if (!form.role) {
    errors.role = 'Choose a role';
  } else if (!isAssignableRole(form.role)) {
    errors.role = 'This role cannot be assigned here';
  } else if (isCompanyWideRole(form.role)) {
    // Optional, but the server requires them together.
    if (form.projectId && !form.siteId) errors.siteId = 'Choose a site, or clear the project';
    if (form.siteId && !form.projectId) errors.projectId = 'Choose a project';
  } else {
    if (!form.projectId) errors.projectId = `A project is required for ${roleLabel(form.role).toLowerCase()}s`;
    if (!form.siteId) errors.siteId = `A site is required for ${roleLabel(form.role).toLowerCase()}s`;
  }

  return errors;
}

export interface CreateMemberPayload {
  email:             string;
  firstName:         string;
  lastName:          string;
  role:              AssignableTeamRole;
  phone?:            string;
  consultantType?:   ConsultantType;
  defaultProjectId?: string;
  defaultSiteId?:    string;
}

/** Builds the POST body from a form that passed validateMemberForm. */
export function buildCreatePayload(form: NewMemberForm): CreateMemberPayload {
  if (!form.role || !isAssignableRole(form.role)) {
    throw new Error('buildCreatePayload called with an invalid role');
  }
  const payload: CreateMemberPayload = {
    email:     form.email.trim(),
    firstName: form.firstName.trim(),
    lastName:  form.lastName.trim(),
    role:      form.role,
  };
  const phone = form.phone.trim();
  if (phone) payload.phone = phone;
  if (form.role === 'consultant' && form.consultantType) payload.consultantType = form.consultantType;
  if (form.projectId && form.siteId) {
    payload.defaultProjectId = form.projectId;
    payload.defaultSiteId    = form.siteId;
  }
  return payload;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

interface ErrorLike {
  status?:  number;
  message?: string;
  details?: Record<string, string[] | undefined>;
}

/** Turns a failed create into one sentence an admin can act on. */
export function describeCreateError(err: unknown): string {
  const e = (err ?? {}) as ErrorLike;
  switch (e.status) {
    case 409:
      return 'An account with this email already exists. Each email can belong to only one ConstructOS account.';
    case 404:
      // Server says "Project not found" / "Site not found".
      return `${e.message && e.message !== 'Request failed' ? e.message : 'Project or site not found'} in your company. Refresh the page and choose the project and site again.`;
    case 403:
      return 'Only company admins can add team members.';
    case 422: {
      const fieldMessages = Object.entries(e.details ?? {})
        .flatMap(([field, msgs]) => (msgs ?? []).map((m) => `${field}: ${m}`));
      if (fieldMessages.length) return `Please fix: ${fieldMessages.join('; ')}`;
      return e.message || 'Some details are invalid.';
    }
    case 408:
      return 'The request timed out. Check the team list before retrying — the member may already have been added.';
    default:
      return e.message || 'Could not add the team member. Please try again.';
  }
}
