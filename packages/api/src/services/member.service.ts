import { prisma } from '../utils/prisma';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';
import { RequestUser } from '../types';
import { UserRole } from '@prisma/client';

// Roles that can be assigned as project members
const ASSIGNABLE_ROLES: UserRole[] = [
  'project_manager',
  'site_supervisor',
  'contractor',
  'consultant',
  'viewer',
];

export interface AddMemberInput {
  userId: string;
  siteId?: string;
}

const MEMBER_SELECT = {
  id: true,
  projectId: true,
  userId: true,
  siteId: true,
  assignedAt: true,
  removedAt: true,
  user: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      consultantType: true,
    },
  },
  site: {
    select: { id: true, name: true },
  },
} as const;

export async function listMembers(projectId: string, actor: RequestUser) {
  return prisma.projectMember.findMany({
    where: {
      projectId,
      removedAt: null,
      // Scope to actor's company via project
      project: { companyId: actor.companyId },
    },
    select: MEMBER_SELECT,
    orderBy: { assignedAt: 'asc' },
  });
}

export async function addMember(
  projectId: string,
  input: AddMemberInput,
  actor: RequestUser,
) {
  // Verify the project belongs to actor's company
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: actor.companyId },
  });
  if (!project) throw new NotFoundError('Project');

  // Verify the user to add belongs to the same company
  const targetUser = await prisma.user.findFirst({
    where: { id: input.userId, companyId: actor.companyId, isActive: true },
  });
  if (!targetUser) throw new NotFoundError('User');

  // Only non-admin roles need project membership
  if (!ASSIGNABLE_ROLES.includes(targetUser.role)) {
    throw new ValidationError(
      `Users with role '${targetUser.role}' do not need explicit project assignment`,
    );
  }

  // If a siteId is given, verify it belongs to the project
  if (input.siteId) {
    const site = await prisma.jobSite.findFirst({
      where: { id: input.siteId, projectId, companyId: actor.companyId },
    });
    if (!site) throw new NotFoundError('Job site');
  }

  // Check if already an active member
  const existing = await prisma.projectMember.findFirst({
    where: { projectId, userId: input.userId, removedAt: null },
  });
  if (existing) throw new ConflictError('User is already a member of this project');

  const member = await prisma.projectMember.create({
    data: {
      companyId: actor.companyId,
      projectId,
      userId: input.userId,
      siteId: input.siteId ?? null,
    },
    select: MEMBER_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: 'create',
      entityType: 'project_member',
      entityId: member.id,
      changesAfter: {
        projectId,
        addedUserId: input.userId,
        siteId: input.siteId ?? null,
      },
    },
  });

  return member;
}

export async function removeMember(
  projectId: string,
  targetUserId: string,
  actor: RequestUser,
) {
  const membership = await prisma.projectMember.findFirst({
    where: {
      projectId,
      userId: targetUserId,
      removedAt: null,
      project: { companyId: actor.companyId },
    },
  });

  if (!membership) throw new NotFoundError('Project membership');

  await prisma.projectMember.update({
    where: { id: membership.id },
    data: { removedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: 'delete',
      entityType: 'project_member',
      entityId: membership.id,
      changesBefore: { projectId, userId: targetUserId },
    },
  });
}
