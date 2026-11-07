import { prisma } from '../utils/prisma';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';
import { RequestUser } from '../types';
import { Prisma, UserRole } from '@prisma/client';

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

  // (projectId, userId) is unique and removal is a soft delete, so a
  // previously removed member still owns that row. Re-adding restores it with
  // the scope from THIS request (the old siteId is not carried over); an
  // active membership is a conflict. Everything happens in one transaction,
  // and the restore is conditional on the row still being removed, so two
  // concurrent adds cannot both succeed.
  const siteId = input.siteId ?? null;
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.projectMember.findUnique({
        where:  { projectId_userId: { projectId, userId: input.userId } },
        select: { id: true, siteId: true, removedAt: true },
      });
      if (existing && existing.removedAt === null) {
        throw new ConflictError('User is already a member of this project');
      }

      if (existing) {
        const restored = await tx.projectMember.updateMany({
          where: { id: existing.id, removedAt: { not: null } },
          data:  {
            companyId:  actor.companyId,
            siteId,
            removedAt:  null,
            assignedAt: new Date(),
          },
        });
        if (restored.count === 0) {
          throw new ConflictError('User is already a member of this project');
        }

        await tx.auditLog.create({
          data: {
            companyId:  actor.companyId,
            userId:     actor.id,
            userEmail:  actor.email,
            userRole:   actor.role,
            action:     'create',
            entityType: 'project_member',
            entityId:   existing.id,
            changesBefore: {
              projectId,
              userId:    input.userId,
              siteId:    existing.siteId,
              removedAt: existing.removedAt!.toISOString(),
            },
            changesAfter: {
              event:       'member_readded',
              projectId,
              addedUserId: input.userId,
              siteId,
            },
          },
        });

        return tx.projectMember.findUniqueOrThrow({
          where:  { id: existing.id },
          select: MEMBER_SELECT,
        });
      }

      const member = await tx.projectMember.create({
        data: {
          companyId: actor.companyId,
          projectId,
          userId: input.userId,
          siteId,
        },
        select: MEMBER_SELECT,
      });

      await tx.auditLog.create({
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
            siteId,
          },
        },
      });

      return member;
    });
  } catch (err) {
    // A concurrent first-time add won the insert race.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError('User is already a member of this project');
    }
    throw err;
  }
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
