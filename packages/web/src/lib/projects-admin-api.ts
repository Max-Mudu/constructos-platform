/**
 * Project and job-site management — role rules, form helpers and the API
 * calls lib/api.ts does not have (site update with coordinates/isActive).
 *
 * Role lists mirror the API's requireRole() preHandlers. They only decide what
 * the UI offers — the API stays the authority — so keep them equal to the
 * routes, never wider (tests/projects-admin.test.ts compares them):
 *   project.routes.ts  POST /projects, PATCH/DELETE /projects/:id  company_admin
 *   jobsite.routes.ts  POST/PATCH /projects/:id/sites[/:siteId]       company_admin, project_manager
 *                      DELETE /projects/:id/sites/:siteId             company_admin
 *
 * lib/api.ts keeps its request() helper private, so apiCall() below is the
 * same thin wrapper lib/team-api.ts uses: bearer token from the auth store,
 * one refresh-and-retry on 401 through authApi.me() (the shared, de-duplicated
 * refresh), and the server's error body kept on the thrown ApiError.
 */
import { ApiError, authApi } from '@/lib/api';
import { getAccessToken, useAuthStore } from '@/store/auth.store';
import type { JobSite, Project, UserRole } from '@/lib/types';

// ─── Roles ───────────────────────────────────────────────────────────────────

type Roles = readonly UserRole[];

export const PROJECT_ROLES = {
  /** POST /projects */
  create:  ['company_admin'] as Roles,
  /** PATCH /projects/:projectId */
  update:  ['company_admin'] as Roles,
} as const;

export const SITE_ROLES = {
  /** POST /projects/:projectId/sites */
  create:     ['company_admin', 'project_manager'] as Roles,
  /** PATCH /projects/:projectId/sites/:siteId (name, address, coordinates, isActive) */
  update:     ['company_admin', 'project_manager'] as Roles,
} as const;

const has = (roles: Roles, role: UserRole | null | undefined) => !!role && roles.includes(role);

export const canCreateProject = (role: UserRole | null | undefined) => has(PROJECT_ROLES.create, role);
export const canEditProject   = (role: UserRole | null | undefined) => has(PROJECT_ROLES.update, role);
export const canCreateSite    = (role: UserRole | null | undefined) => has(SITE_ROLES.create, role);
export const canEditSite      = (role: UserRole | null | undefined) => has(SITE_ROLES.update, role);

// ─── Project status ──────────────────────────────────────────────────────────

export type ProjectStatus = Project['status'];

/** Same values as the Prisma ProjectStatus enum / project.routes.ts projectStatusEnum. */
export const PROJECT_STATUSES: readonly ProjectStatus[] = ['planning', 'active', 'on_hold', 'completed', 'archived'];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning:  'Planning',
  active:    'Active',
  on_hold:   'On Hold',
  completed: 'Completed',
  archived:  'Archived',
};

/**
 * Statuses a user can pick on the project list filter and the create/edit
 * forms. "archived" is left out: GET /projects hides archived projects
 * (project.service.ts listProjects), so choosing it from a form made the
 * project vanish from the list with no way back in the UI. An already
 * archived project keeps its status as an option on the edit form so it is
 * shown truthfully.
 */
export function selectableStatuses(current?: ProjectStatus | null): { value: ProjectStatus; label: string }[] {
  const list = PROJECT_STATUSES.filter((s) => s !== 'archived' || current === 'archived');
  return list.map((value) => ({ value, label: PROJECT_STATUS_LABELS[value] }));
}

export function statusVariant(s: string): 'active' | 'pending' | 'secondary' | 'inactive' | 'info' {
  if (s === 'active')    return 'active';
  if (s === 'on_hold')   return 'pending';
  if (s === 'completed') return 'secondary';
  if (s === 'planning')  return 'info';
  return 'inactive';
}

export function statusLabel(s: string): string {
  return PROJECT_STATUS_LABELS[s as ProjectStatus] ?? s.replace(/_/g, ' ');
}

// ─── Project form ────────────────────────────────────────────────────────────

export interface ProjectFormValues {
  name:        string;
  code:        string;
  description: string;
  location:    string;
  startDate:   string;
  endDate:     string;
  status:      ProjectStatus;
}

/** "2026-11-06T00:00:00.000Z" → "2026-11-06" (dates are stored as calendar dates). */
export function dateInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return m ? m[1] : '';
}

export function projectToForm(p: Project): ProjectFormValues {
  return {
    name:        p.name,
    code:        p.code ?? '',
    description: p.description ?? '',
    location:    p.location ?? '',
    startDate:   dateInputValue(p.startDate),
    endDate:     dateInputValue(p.endDate),
    status:      p.status,
  };
}

export type ProjectUpdatePayload = Partial<{
  name: string; code: string; description: string; location: string;
  startDate: string | null; endDate: string | null; status: ProjectStatus;
}>;

/**
 * Only the fields that changed. The update schema accepts null for the dates
 * but not for code/description/location (z.string().optional()), so a cleared
 * text field is sent as "" — which the service stores as-is.
 */
export function projectUpdatePayload(before: Project, form: ProjectFormValues): ProjectUpdatePayload {
  const prev = projectToForm(before);
  const out: ProjectUpdatePayload = {};
  if (form.name.trim() !== prev.name)               out.name = form.name.trim();
  if (form.code.trim() !== prev.code)               out.code = form.code.trim();
  if (form.description.trim() !== prev.description) out.description = form.description.trim();
  if (form.location.trim() !== prev.location)       out.location = form.location.trim();
  if (form.startDate !== prev.startDate)            out.startDate = form.startDate || null;
  if (form.endDate !== prev.endDate)                out.endDate = form.endDate || null;
  if (form.status !== prev.status)                  out.status = form.status;
  return out;
}

/** Client-side checks the API does not make (it accepts an end before the start). */
export function projectFormErrors(form: ProjectFormValues): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (!form.name.trim()) errors.name = ['Project name is required'];
  if (form.startDate && form.endDate && form.endDate < form.startDate) {
    errors.endDate = ['End date cannot be before the start date'];
  }
  return errors;
}

// ─── Site form ───────────────────────────────────────────────────────────────

export interface SiteFormValues {
  name:      string;
  address:   string;
  latitude:  string;
  longitude: string;
  isActive:  boolean;
}

export function siteToForm(s: JobSite): SiteFormValues {
  return {
    name:      s.name,
    address:   s.address ?? '',
    latitude:  s.latitude == null ? '' : String(Number(s.latitude)),
    longitude: s.longitude == null ? '' : String(Number(s.longitude)),
    isActive:  s.isActive,
  };
}

export function emptySiteForm(): SiteFormValues {
  return { name: '', address: '', latitude: '', longitude: '', isActive: true };
}

/** Same bounds as jobsite.routes.ts (latitude -90..90, longitude -180..180). */
export function siteFormErrors(form: SiteFormValues): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  if (!form.name.trim()) errors.name = ['Site name is required'];
  const lat = form.latitude.trim();
  const lng = form.longitude.trim();
  if (lat && !(Number.isFinite(Number(lat)) && Math.abs(Number(lat)) <= 90)) {
    errors.latitude = ['Latitude must be a number between -90 and 90'];
  }
  if (lng && !(Number.isFinite(Number(lng)) && Math.abs(Number(lng)) <= 180)) {
    errors.longitude = ['Longitude must be a number between -180 and 180'];
  }
  if (!!lat !== !!lng && !errors.latitude && !errors.longitude) {
    errors[lat ? 'longitude' : 'latitude'] = ['Enter both latitude and longitude, or neither'];
  }
  return errors;
}

export interface SiteCreatePayload { name: string; address?: string; latitude?: number; longitude?: number }
export type SiteUpdatePayload = Partial<{
  name: string; address: string; latitude: number | null; longitude: number | null; isActive: boolean;
}>;

export function siteCreatePayload(form: SiteFormValues): SiteCreatePayload {
  const out: SiteCreatePayload = { name: form.name.trim() };
  if (form.address.trim()) out.address = form.address.trim();
  if (form.latitude.trim() && form.longitude.trim()) {
    out.latitude = Number(form.latitude);
    out.longitude = Number(form.longitude);
  }
  return out;
}

/** Only changed fields; coordinates clear to null, address clears to "" (the schema has no null). */
export function siteUpdatePayload(before: JobSite, form: SiteFormValues): SiteUpdatePayload {
  const prev = siteToForm(before);
  const out: SiteUpdatePayload = {};
  if (form.name.trim() !== prev.name)       out.name = form.name.trim();
  if (form.address.trim() !== prev.address) out.address = form.address.trim();
  const lat = form.latitude.trim();
  const lng = form.longitude.trim();
  if (lat !== prev.latitude || lng !== prev.longitude) {
    out.latitude  = lat ? Number(lat) : null;
    out.longitude = lng ? Number(lng) : null;
  }
  if (form.isActive !== prev.isActive)      out.isActive = form.isActive;
  return out;
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

const BASE = '/api/v1';
const TIMEOUT_MS = 15_000;

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  json?:   unknown;
}

async function rawFetch(path: string, opts: CallOptions): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE}${path}`, {
      method:      opts.method ?? 'GET',
      headers,
      body:        opts.json === undefined ? undefined : JSON.stringify(opts.json),
      credentials: 'include',
      cache:       'no-store',
      signal:      controller.signal,
    });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') throw new ApiError(408, 'TIMEOUT', 'Request timed out');
    throw new ApiError(0, 'NETWORK', 'Network error');
  } finally {
    clearTimeout(timer);
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  let body: { error?: unknown; code?: unknown; details?: unknown } = {};
  try { body = (await res.json()) as typeof body; } catch { /* non-JSON */ }
  return new ApiError(
    res.status,
    typeof body.code === 'string' ? body.code : 'API_ERROR',
    typeof body.error === 'string' ? body.error : 'Request failed',
    body.details && typeof body.details === 'object' ? (body.details as Record<string, string[]>) : undefined,
  );
}

async function refreshSession(): Promise<boolean> {
  try {
    await authApi.me();
    return !!getAccessToken();
  } catch {
    return false;
  }
}

function sessionEnded(): ApiError {
  useAuthStore.getState().expireSession();
  return new ApiError(401, 'UNAUTHORIZED', 'Session expired');
}

/** Shared by lib/members-api.ts. Resolves undefined for 204 No Content. */
export async function apiCall<T>(path: string, opts: CallOptions = {}): Promise<T> {
  let res = await rawFetch(path, opts);
  if (res.status === 401) {
    if (!(await refreshSession())) throw sessionEnded();
    res = await rawFetch(path, opts);
    if (res.status === 401) throw sessionEnded();
  }
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

export const siteAdminApi = {
  /** POST /projects/:projectId/sites */
  create: (projectId: string, payload: SiteCreatePayload) =>
    apiCall<{ site: JobSite }>(`/projects/${enc(projectId)}/sites`, { method: 'POST', json: payload }),

  /** PATCH /projects/:projectId/sites/:siteId */
  update: (projectId: string, siteId: string, payload: SiteUpdatePayload) =>
    apiCall<{ site: JobSite }>(`/projects/${enc(projectId)}/sites/${enc(siteId)}`, { method: 'PATCH', json: payload }),
};

export const projectAdminApi = {
  /** PATCH /projects/:projectId */
  update: (projectId: string, payload: ProjectUpdatePayload) =>
    apiCall<{ project: Project }>(`/projects/${enc(projectId)}`, { method: 'PATCH', json: payload }),
};
