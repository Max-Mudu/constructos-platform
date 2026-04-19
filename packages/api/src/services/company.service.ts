import { prisma } from '../utils/prisma';
import { NotFoundError } from '../utils/errors';
import { RequestUser } from '../types';

export interface UpdateCompanyInput {
  name?: string;
  country?: string;
  currency?: string;
  timezone?: string;
}

export async function getCompany(companyId: string) {
  const company = await prisma.company.findFirst({
    where: { id: companyId, isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      country: true,
      currency: true,
      timezone: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!company) throw new NotFoundError('Company');
  return company;
}

export async function updateCompany(
  companyId: string,
  input: UpdateCompanyInput,
  actor: RequestUser,
) {
  const before = await getCompany(companyId);

  const updated = await prisma.company.update({
    where: { id: companyId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.country !== undefined && { country: input.country }),
      ...(input.currency !== undefined && { currency: input.currency }),
      ...(input.timezone !== undefined && { timezone: input.timezone }),
    },
    select: {
      id: true,
      name: true,
      slug: true,
      country: true,
      currency: true,
      timezone: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      companyId,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: 'update',
      entityType: 'company',
      entityId: companyId,
      changesBefore: before as object,
      changesAfter: updated as object,
    },
  });

  return updated;
}
