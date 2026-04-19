import { prisma } from '../utils/prisma';
import { NotFoundError } from '../utils/errors';
import { RequestUser } from '../types';
import { getAccessibleSiteIds } from '../middleware/requireProjectAccess';

export interface CreateSiteInput {
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface UpdateSiteInput {
  name?: string;
  address?: string;
  latitude?: number | null;
  longitude?: number | null;
  isActive?: boolean;
}

const SITE_SELECT = {
  id: true,
  companyId: true,
  projectId: true,
  name: true,
  address: true,
  latitude: true,
  longitude: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listSites(projectId: string, actor: RequestUser) {
  const accessibleSiteIds = await getAccessibleSiteIds(projectId, actor.id, actor.role);

  return prisma.jobSite.findMany({
    where: {
      projectId,
      companyId: actor.companyId,
      ...(accessibleSiteIds !== null && { id: { in: accessibleSiteIds } }),
    },
    select: SITE_SELECT,
    orderBy: { createdAt: 'asc' },
  });
}

export async function getSite(siteId: string, projectId: string, actor: RequestUser) {
  const accessibleSiteIds = await getAccessibleSiteIds(projectId, actor.id, actor.role);

  // If scoped to specific sites, check access before querying
  if (accessibleSiteIds !== null && !accessibleSiteIds.includes(siteId)) {
    throw new NotFoundError('Job site');
  }

  const site = await prisma.jobSite.findFirst({
    where: { id: siteId, projectId, companyId: actor.companyId },
    select: SITE_SELECT,
  });

  if (!site) throw new NotFoundError('Job site');
  return site;
}

export async function createSite(
  projectId: string,
  input: CreateSiteInput,
  actor: RequestUser,
) {
  const site = await prisma.jobSite.create({
    data: {
      companyId: actor.companyId,
      projectId,
      name: input.name,
      address: input.address,
      latitude: input.latitude,
      longitude: input.longitude,
    },
    select: SITE_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: 'create',
      entityType: 'job_site',
      entityId: site.id,
      changesAfter: site as object,
    },
  });

  return site;
}

export async function updateSite(
  siteId: string,
  projectId: string,
  input: UpdateSiteInput,
  actor: RequestUser,
) {
  const before = await prisma.jobSite.findFirst({
    where: { id: siteId, projectId, companyId: actor.companyId },
    select: SITE_SELECT,
  });
  if (!before) throw new NotFoundError('Job site');

  const updated = await prisma.jobSite.update({
    where: { id: siteId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.address !== undefined && { address: input.address }),
      ...(input.latitude !== undefined && { latitude: input.latitude }),
      ...(input.longitude !== undefined && { longitude: input.longitude }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    },
    select: SITE_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: 'update',
      entityType: 'job_site',
      entityId: siteId,
      changesBefore: before as object,
      changesAfter: updated as object,
    },
  });

  return updated;
}

export async function deactivateSite(
  siteId: string,
  projectId: string,
  actor: RequestUser,
) {
  const site = await prisma.jobSite.findFirst({
    where: { id: siteId, projectId, companyId: actor.companyId },
    select: SITE_SELECT,
  });
  if (!site) throw new NotFoundError('Job site');

  const updated = await prisma.jobSite.update({
    where: { id: siteId },
    data: { isActive: false },
    select: SITE_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: 'delete',
      entityType: 'job_site',
      entityId: siteId,
      changesBefore: site as object,
      changesAfter: { isActive: false },
    },
  });

  return updated;
}
