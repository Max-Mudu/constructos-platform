import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { Project, UserRole } from '@prisma/client';
import { env } from '../utils/env';

// Roles that see all projects in their company without needing a project_member row
const COMPANY_WIDE_ROLES: UserRole[] = ['super_admin', 'company_admin', 'finance_officer'];

declare module 'fastify' {
  interface FastifyRequest {
    project: Project;
  }
}

/**
 * Verifies the requesting user can access the project identified by
 * request.params.projectId. Attaches the project to request.project.
 *
 * Rules:
 *  - company_admin / finance_officer: any project in their company
 *  - all other roles: must have an active row in project_members
 *  - site_supervisor: project_members row may be site-scoped — still grants project-level read
 *  - when the route has a :siteId param, that site must belong to the project
 *    (and the user's company), else 404 'Site not found'
 */
export async function requireProjectAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { projectId } = request.params as { projectId: string };
  const user = request.user;

  if (!projectId) {
    reply.status(400).send({ error: 'projectId param missing', code: 'BAD_REQUEST' });
    return;
  }

  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: user.companyId },
  });

  if (!project) {
    const err = new NotFoundError('Project');
    reply.status(404).send({ error: err.message, code: err.code });
    return;
  }

  if (!COMPANY_WIDE_ROLES.includes(user.role)) {
    const membership = await prisma.projectMember.findFirst({
      where: {
        projectId,
        userId: user.id,
        removedAt: null,
      },
    });

    if (!membership) {
      await prisma.auditLog.create({
        data: {
          companyId: user.companyId,
          userId: user.id,
          userEmail: user.email,
          userRole: user.role,
          action: 'permission_denied',
          entityType: 'project',
          entityId: projectId,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        },
      });
      const err = new ForbiddenError('You do not have access to this project');
      reply.status(403).send({ error: err.message, code: err.code });
      return;
    }
  }

  // Routes mounted under /projects/:projectId/sites/:siteId/... — the site must
  // belong to this project and company. One generic 404 for every failure mode
  // (wrong project, other tenant, nonexistent) so nothing is disclosed.
  // Site scoping for site-scoped roles stays in the services (getAccessibleSiteIds).
  const { siteId } = request.params as { siteId?: string };
  if (siteId !== undefined) {
    const site = await prisma.jobSite.findFirst({
      where: { id: siteId, projectId, companyId: user.companyId },
      select: { id: true },
    });
    if (!site) {
      const err = new NotFoundError('Site');
      reply.status(404).send({ error: err.message, code: err.code });
      return;
    }
  }

  request.project = project;
}

/**
 * Returns the list of project IDs the user can access.
 * Used for list queries.
 */
export async function getAccessibleProjectIds(
  companyId: string,
  userId: string,
  role: UserRole,
): Promise<string[] | null> {
  // null means "all projects in company" (no additional filter needed)
  if (COMPANY_WIDE_ROLES.includes(role)) return null;

  const memberships = await prisma.projectMember.findMany({
    where: { userId, removedAt: null },
    select: { projectId: true },
  });

  return memberships.map((m) => m.projectId);
}

/** Site-scoped roles while SITE_SCOPE_STRICT is off (the long-standing rule). */
const DEFAULT_SITE_SCOPED_ROLES: readonly UserRole[] = ['site_supervisor'];

/**
 * Site-scoped roles while SITE_SCOPE_STRICT is on: the same set as the Daily
 * Report policy (DAILY_REPORT_SITE_SCOPED_ROLES). Project managers stay
 * project-wide; company-wide roles never reach a site check.
 */
export const STRICT_SITE_SCOPED_ROLES: readonly UserRole[] = ['site_supervisor', 'viewer', 'consultant'];

/** Roles whose project membership siteId limits them, under the current flag. */
export function siteScopedRoles(): readonly UserRole[] {
  return env.SITE_SCOPE_STRICT ? STRICT_SITE_SCOPED_ROLES : DEFAULT_SITE_SCOPED_ROLES;
}

/**
 * For site-scoped roles (site_supervisor; plus viewer and consultant when
 * SITE_SCOPE_STRICT is on): the site IDs they are assigned to in the project.
 * A membership with no site_id means the whole project (null). Returns null
 * for roles that can see all sites in a project.
 */
export async function getAccessibleSiteIds(
  projectId: string,
  userId: string,
  role: UserRole,
): Promise<string[] | null> {
  if (!siteScopedRoles().includes(role)) return null;

  const memberships = await prisma.projectMember.findMany({
    where: { projectId, userId, removedAt: null, siteId: { not: null } },
    select: { siteId: true },
  });

  // A membership with no site_id grants every site of the project
  const openMembership = await prisma.projectMember.findFirst({
    where: { projectId, userId, removedAt: null, siteId: null },
  });

  if (openMembership) return null;

  return memberships.map((m) => m.siteId as string);
}

/**
 * Site allow-list for project documents whose siteId is optional (drawings,
 * consultant instructions). null = no site filter.
 *  - SITE_SCOPE_STRICT off (default): always null — project membership alone.
 *  - on: getAccessibleSiteIds (site_supervisor, viewer, consultant). Callers
 *    keep records with siteId null (project-level documents) visible.
 */
export async function getDocumentSiteIds(
  projectId: string,
  userId: string,
  role: UserRole,
): Promise<string[] | null> {
  if (!env.SITE_SCOPE_STRICT) return null;
  return getAccessibleSiteIds(projectId, userId, role);
}
