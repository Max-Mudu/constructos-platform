import { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { Project, UserRole } from '@prisma/client';

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

/**
 * For site_supervisor: returns the site IDs they are explicitly assigned to.
 * Returns null for roles that can see all sites in a project.
 */
export async function getAccessibleSiteIds(
  projectId: string,
  userId: string,
  role: UserRole,
): Promise<string[] | null> {
  if (role !== 'site_supervisor') return null;

  const memberships = await prisma.projectMember.findMany({
    where: { projectId, userId, removedAt: null, siteId: { not: null } },
    select: { siteId: true },
  });

  // If supervisor has a membership with no site_id, they can see all sites
  const openMembership = await prisma.projectMember.findFirst({
    where: { projectId, userId, removedAt: null, siteId: null },
  });

  if (openMembership) return null;

  return memberships.map((m) => m.siteId as string);
}
