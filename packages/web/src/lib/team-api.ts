/**
 * Company team management — HTTP client.
 *
 * Base: /api/v1/companies/me/users (company_admin only; the API enforces it).
 *
 * lib/api.ts keeps its request() helper private, so this mirrors the thin
 * wrapper used by lib/daily-report-api.ts: bearer token from the auth store,
 * one refresh-and-retry on 401 through authApi.me() (which goes through the
 * shared, de-duplicated refresh), and the server's error body kept on the
 * thrown ApiError (code, message, field details).
 *
 * Security: the create response may carry a one-time `setupLink` outside
 * production. This module never logs, caches or stores it — `cache:
 * 'no-store'` keeps it out of the HTTP cache, and the caller is responsible
 * for holding it in component state only.
 */
import { ApiError, authApi } from '@/lib/api';
import { getAccessToken, useAuthStore } from '@/store/auth.store';
import type { UserRole } from '@/lib/types';
import type { ConsultantType, CreateMemberPayload } from '@/lib/team-roles';

const BASE = '/api/v1';
const USERS_PATH = '/companies/me/users';
const TIMEOUT_MS = 20_000;

/** Same ceiling as the API (LIST_USERS_MAX_LIMIT). */
export const TEAM_LIST_MAX_LIMIT = 200;

export interface TeamRef {
  id:   string;
  name: string;
}

export interface TeamMembership {
  projectId:   string;
  projectName: string;
  /** null = project-wide membership */
  siteId:      string | null;
  siteName:    string | null;
  assignedAt:  string;
}

export interface TeamMember {
  id:                 string;
  email:              string;
  firstName:          string;
  lastName:           string;
  phone:              string | null;
  role:               UserRole;
  consultantType:     ConsultantType | null;
  isActive:           boolean;
  createdAt:          string;
  defaultProject:     TeamRef | null;
  defaultSite:        TeamRef | null;
  projectMemberships: TeamMembership[];
}

export interface TeamListQuery {
  role?:     UserRole;
  isActive?: boolean;
  search?:   string;
  limit?:    number;
  offset?:   number;
}

export interface TeamListResponse {
  users:  TeamMember[];
  total:  number;
  limit:  number;
  offset: number;
}

export interface CreatedTeamMember {
  id:               string;
  email:            string;
  firstName:        string;
  lastName:         string;
  phone:            string | null;
  role:             UserRole;
  consultantType:   ConsultantType | null;
  canViewFinance:   boolean;
  isActive:         boolean;
  defaultProjectId: string | null;
  defaultSiteId:    string | null;
  createdAt:        string;
}

export interface CreateTeamMemberResponse {
  user:           CreatedTeamMember;
  /** Present outside production only. One-time, expires in 60 minutes. */
  setupLink?:     string;
  setupEmailSent: boolean;
}

/** PATCH /companies/me/users/:id/status — the same allowlist the API returns. */
export interface TeamStatusUser {
  id:        string;
  email:     string;
  firstName: string;
  lastName:  string;
  role:      UserRole;
  isActive:  boolean;
}

export interface SetTeamMemberStatusResponse {
  user:                   TeamStatusUser;
  /** false when the member already had the requested status. */
  changed:                boolean;
  refreshTokensRevoked:   number;
  setupTokensInvalidated: number;
}

export function buildListQueryString(q: TeamListQuery = {}): string {
  const qs = new URLSearchParams();
  if (q.role) qs.set('role', q.role);
  if (q.isActive !== undefined) qs.set('isActive', q.isActive ? 'true' : 'false');
  const search = q.search?.trim().slice(0, 100);
  if (search) qs.set('search', search);
  if (q.limit !== undefined) {
    qs.set('limit', String(Math.min(TEAM_LIST_MAX_LIMIT, Math.max(1, Math.floor(q.limit)))));
  }
  if (q.offset !== undefined && q.offset > 0) qs.set('offset', String(Math.floor(q.offset)));
  const s = qs.toString();
  return s ? `?${s}` : '';
}

interface CallOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  json?:   unknown;
  signal?: AbortSignal;
}

async function rawFetch(path: string, opts: CallOptions): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
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
    if ((err as { name?: string })?.name === 'AbortError') {
      if (timedOut) throw new ApiError(408, 'TIMEOUT', 'Request timed out');
      throw err; // caller cancelled
    }
    throw new ApiError(0, 'NETWORK', 'Network error');
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  let body: { error?: unknown; code?: unknown; details?: unknown } = {};
  try { body = (await res.json()) as typeof body; } catch { /* non-JSON */ }
  return new ApiError(
    res.status,
    typeof body.code === 'string' ? body.code : 'API_ERROR',
    typeof body.error === 'string' ? body.error : 'Request failed',
    body.details && typeof body.details === 'object'
      ? (body.details as Record<string, string[]>)
      : undefined,
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

async function call<T>(path: string, opts: CallOptions = {}): Promise<T> {
  let res = await rawFetch(path, opts);
  if (res.status === 401) {
    if (!(await refreshSession())) throw sessionEnded();
    res = await rawFetch(path, opts);
    if (res.status === 401) throw sessionEnded();
  }
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as T;
}

export const teamApi = {
  /** GET /companies/me/users */
  list: (q: TeamListQuery = {}, signal?: AbortSignal) =>
    call<TeamListResponse>(`${USERS_PATH}${buildListQueryString(q)}`, { signal }),

  /**
   * POST /companies/me/users. Not retried on timeout: the user may already
   * exist, and a blind retry would surface as a confusing 409.
   */
  create: (payload: CreateMemberPayload) =>
    call<CreateTeamMemberResponse>(USERS_PATH, { method: 'POST', json: payload }),

  /**
   * PATCH /companies/me/users/:id/status. Deactivating signs the member out
   * everywhere at once; the API refuses (409) self-deactivation and the last
   * active company admin, and those messages are meant to be shown as-is.
   * Idempotent on the server, so a repeat is harmless.
   */
  setStatus: (userId: string, isActive: boolean) =>
    call<SetTeamMemberStatusResponse>(
      `${USERS_PATH}/${encodeURIComponent(userId)}/status`,
      { method: 'PATCH', json: { isActive } },
    ),
};
