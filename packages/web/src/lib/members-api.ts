/**
 * Project members — HTTP client, role rules and picker logic.
 *
 * API (packages/api/src/routes/member.routes.ts, services/member.service.ts):
 *   GET    /projects/:projectId/members          company_admin, project_manager
 *   POST   /projects/:projectId/members          company_admin   { userId, siteId? }
 *   DELETE /projects/:projectId/members/:userId  company_admin   (soft remove)
 *
 * Only company_admin can add, and only company_admin can list company users
 * (GET /companies/me/users), so the "add" picker is offered to admins only and
 * a project manager gets a read-only member list. The API adds only active
 * users of the actor's company whose role is in ASSIGNABLE_ROLES; admins and
 * finance officers see every project without membership and are rejected, so
 * the picker leaves them out rather than offering a choice that fails.
 */
import { ApiError } from '@/lib/api';
import type { UserRole } from '@/lib/types';
import type { TeamMember } from '@/lib/team-api';
import { apiCall } from '@/lib/projects-admin-api';

type Roles = readonly UserRole[];

export const MEMBER_ROLES = {
  list:   ['company_admin', 'project_manager'] as Roles,
  add:    ['company_admin'] as Roles,
  remove: ['company_admin'] as Roles,
} as const;

/** member.service.ts ASSIGNABLE_ROLES — the roles that need explicit project membership. */
export const ASSIGNABLE_ROLES: Roles = ['project_manager', 'site_supervisor', 'contractor', 'consultant', 'viewer'];

const has = (roles: Roles, role: UserRole | null | undefined) => !!role && roles.includes(role);
export const canListMembers  = (role: UserRole | null | undefined) => has(MEMBER_ROLES.list, role);
export const canAddMembers   = (role: UserRole | null | undefined) => has(MEMBER_ROLES.add, role);
export const canRemoveMembers = (role: UserRole | null | undefined) => has(MEMBER_ROLES.remove, role);

export interface ProjectMember {
  id:         string;
  projectId:  string;
  userId:     string;
  /** null = project-wide (every site) */
  siteId:     string | null;
  assignedAt: string;
  removedAt:  string | null;
  user: {
    id:             string;
    firstName:      string;
    lastName:       string;
    email:          string;
    role:           UserRole;
    consultantType: string | null;
  };
  site: { id: string; name: string } | null;
}

const enc = encodeURIComponent;

export const membersApi = {
  list: (projectId: string) =>
    apiCall<{ members: ProjectMember[] }>(`/projects/${enc(projectId)}/members`),

  /** userId must be a company user id (uuid); siteId must be a site of this project. */
  add: (projectId: string, payload: { userId: string; siteId?: string }) =>
    apiCall<{ member: ProjectMember }>(`/projects/${enc(projectId)}/members`, {
      method: 'POST',
      json: payload.siteId ? { userId: payload.userId, siteId: payload.siteId } : { userId: payload.userId },
    }),

  remove: (projectId: string, userId: string) =>
    apiCall<void>(`/projects/${enc(projectId)}/members/${enc(userId)}`, { method: 'DELETE' }),
};

/**
 * Company users that can be added: active, an assignable role, and not
 * already an active member of the project. Sorted by name.
 */
export function addableUsers(
  users: readonly Pick<TeamMember, 'id' | 'firstName' | 'lastName' | 'email' | 'role' | 'isActive'>[],
  members: readonly Pick<ProjectMember, 'userId'>[],
) {
  const taken = new Set(members.map((m) => m.userId));
  return users
    .filter((u) => u.isActive && ASSIGNABLE_ROLES.includes(u.role) && !taken.has(u.id))
    .sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`));
}

/**
 * Wording for a failed add. A server error (5xx) is reported with the one
 * known cause: a user who was removed from this project earlier cannot be
 * re-added yet, because removal is a soft delete and project_members has a
 * unique (projectId, userId) constraint (member.service.ts addMember creates
 * a new row instead of restoring the removed one).
 */
export function addErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status >= 500) {
      return 'The server could not add this person. If they were removed from this project before, '
        + 'they cannot be re-added yet — please report it to your administrator.';
    }
    if (err.status === 409) return 'This person is already a member of the project.';
    if (err.details) {
      const first = Object.values(err.details).find((m) => Array.isArray(m) && m.length > 0);
      if (first) return first[0];
    }
    return err.message || 'Failed to add member';
  }
  return 'Failed to add member';
}

export function memberScopeLabel(m: Pick<ProjectMember, 'siteId' | 'site'>): string {
  if (!m.siteId) return 'All sites';
  return m.site?.name ?? 'One site';
}

/** Members ordered by name, for a stable list. */
export function sortMembers<T extends Pick<ProjectMember, 'user'>>(members: readonly T[]): T[] {
  return [...members].sort((a, b) =>
    `${a.user.firstName} ${a.user.lastName}`.localeCompare(`${b.user.firstName} ${b.user.lastName}`));
}

/** Loads every page of active company users (the endpoint caps a page at 200). */
export async function loadAllActiveUsers(
  list: (q: { isActive: boolean; limit: number; offset: number }) => Promise<{ users: TeamMember[]; total: number }>,
  maxPages = 10,
): Promise<TeamMember[]> {
  const out: TeamMember[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const res = await list({ isActive: true, limit: 200, offset: out.length });
    out.push(...res.users);
    if (res.users.length === 0 || out.length >= res.total) break;
  }
  return out;
}
