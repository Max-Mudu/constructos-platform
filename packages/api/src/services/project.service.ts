import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { RequestUser } from '../types';
import { ProjectStatus, UserRole } from '@prisma/client';
import { getAccessibleProjectIds } from '../middleware/requireProjectAccess';

export interface CreateProjectInput {
  name: string;
  code?: string;
  description?: string;
  status?: ProjectStatus;
  startDate?: string;
  endDate?: string;
  location?: string;
}

export interface UpdateProjectInput {
  name?: string;
  code?: string;
  description?: string;
  status?: ProjectStatus;
  startDate?: string | null;
  endDate?: string | null;
  location?: string;
}

const PROJECT_SELECT = {
  id: true,
  companyId: true,
  name: true,
  code: true,
  description: true,
  status: true,
  startDate: true,
  endDate: true,
  location: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { jobSites: true, projectMembers: true } },
} as const;

export async function listProjects(actor: RequestUser) {
  const accessibleIds = await getAccessibleProjectIds(
    actor.companyId,
    actor.id,
    actor.role,
  );

  return prisma.project.findMany({
    where: {
      companyId: actor.companyId,
      status: { not: 'archived' },
      ...(accessibleIds !== null && { id: { in: accessibleIds } }),
    },
    select: PROJECT_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getProject(projectId: string, actor: RequestUser) {
  // requireProjectAccess middleware already checked access — just fetch
  const project = await prisma.project.findFirst({
    where: { id: projectId, companyId: actor.companyId },
    select: PROJECT_SELECT,
  });

  if (!project) throw new NotFoundError('Project');
  return project;
}

export async function createProject(input: CreateProjectInput, actor: RequestUser) {
  const project = await prisma.project.create({
    data: {
      companyId: actor.companyId,
      name: input.name,
      code: input.code,
      description: input.description,
      status: input.status ?? 'planning',
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate ? new Date(input.endDate) : undefined,
      location: input.location,
    },
    select: PROJECT_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: 'create',
      entityType: 'project',
      entityId: project.id,
      changesAfter: project as object,
    },
  });

  return project;
}

export async function updateProject(
  projectId: string,
  input: UpdateProjectInput,
  actor: RequestUser,
) {
  const before = await prisma.project.findFirst({
    where: { id: projectId, companyId: actor.companyId },
    select: PROJECT_SELECT,
  });
  if (!before) throw new NotFoundError('Project');

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.code !== undefined && { code: input.code }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.startDate !== undefined && {
        startDate: input.startDate ? new Date(input.startDate) : null,
      }),
      ...(input.endDate !== undefined && {
        endDate: input.endDate ? new Date(input.endDate) : null,
      }),
      ...(input.location !== undefined && { location: input.location }),
    },
    select: PROJECT_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: 'update',
      entityType: 'project',
      entityId: projectId,
      changesBefore: before as object,
      changesAfter: updated as object,
    },
  });

  return updated;
}

export async function archiveProject(projectId: string, actor: RequestUser) {
  const before = await prisma.project.findFirst({
    where: { id: projectId, companyId: actor.companyId },
    select: PROJECT_SELECT,
  });
  if (!before) throw new NotFoundError('Project');

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: { status: 'archived' },
    select: PROJECT_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: 'delete',
      entityType: 'project',
      entityId: projectId,
      changesBefore: before as object,
      changesAfter: { status: 'archived' },
    },
  });

  return updated;
}
