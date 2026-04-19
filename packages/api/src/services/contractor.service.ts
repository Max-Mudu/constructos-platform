import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { RequestUser } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateContractorInput {
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  registrationNumber?: string;
  tradeSpecialization?: string;
}

export interface UpdateContractorInput {
  name?: string;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  registrationNumber?: string | null;
  tradeSpecialization?: string | null;
  isActive?: boolean;
}

// ─── Select ───────────────────────────────────────────────────────────────────

const CONTRACTOR_SELECT = {
  id:                  true,
  companyId:           true,
  userId:              true,
  name:                true,
  contactPerson:       true,
  email:               true,
  phone:               true,
  registrationNumber:  true,
  tradeSpecialization: true,
  isActive:            true,
  createdAt:           true,
  updatedAt:           true,
} as const;

// ─── Service Functions ────────────────────────────────────────────────────────

export async function listContractors(
  actor: RequestUser,
  filters: { isActive?: boolean; search?: string } = {},
) {
  const where: Record<string, unknown> = { companyId: actor.companyId };

  if (filters.isActive !== undefined) where['isActive'] = filters.isActive;

  if (filters.search) {
    where['OR'] = [
      { name:                { contains: filters.search, mode: 'insensitive' } },
      { contactPerson:       { contains: filters.search, mode: 'insensitive' } },
      { tradeSpecialization: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  // Contractors can only see their own linked record
  if (actor.role === 'contractor') {
    where['userId'] = actor.id;
  }

  return prisma.contractor.findMany({
    where,
    select: CONTRACTOR_SELECT,
    orderBy: { name: 'asc' },
  });
}

export async function getContractor(contractorId: string, actor: RequestUser) {
  const contractor = await prisma.contractor.findFirst({
    where: { id: contractorId, companyId: actor.companyId },
    select: CONTRACTOR_SELECT,
  });
  if (!contractor) throw new NotFoundError('Contractor');

  // Contractors can only view their own record
  if (actor.role === 'contractor' && contractor.userId !== actor.id) {
    throw new ForbiddenError('You do not have access to this contractor');
  }

  return contractor;
}

export async function createContractor(input: CreateContractorInput, actor: RequestUser) {
  const contractor = await prisma.contractor.create({
    data: {
      companyId:           actor.companyId,
      name:                input.name,
      contactPerson:       input.contactPerson       ?? null,
      email:               input.email               ?? null,
      phone:               input.phone               ?? null,
      registrationNumber:  input.registrationNumber  ?? null,
      tradeSpecialization: input.tradeSpecialization ?? null,
    },
    select: CONTRACTOR_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'create',
      entityType:   'contractor',
      entityId:     contractor.id,
      changesAfter: contractor as object,
    },
  });

  return contractor;
}

export async function updateContractor(
  contractorId: string,
  input: UpdateContractorInput,
  actor: RequestUser,
) {
  const before = await prisma.contractor.findFirst({
    where: { id: contractorId, companyId: actor.companyId },
    select: CONTRACTOR_SELECT,
  });
  if (!before) throw new NotFoundError('Contractor');

  const updated = await prisma.contractor.update({
    where: { id: contractorId },
    data: {
      ...(input.name                !== undefined && { name:                input.name }),
      ...(input.contactPerson       !== undefined && { contactPerson:       input.contactPerson }),
      ...(input.email               !== undefined && { email:               input.email }),
      ...(input.phone               !== undefined && { phone:               input.phone }),
      ...(input.registrationNumber  !== undefined && { registrationNumber:  input.registrationNumber }),
      ...(input.tradeSpecialization !== undefined && { tradeSpecialization: input.tradeSpecialization }),
      ...(input.isActive            !== undefined && { isActive:            input.isActive }),
    },
    select: CONTRACTOR_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'update',
      entityType:    'contractor',
      entityId:      contractorId,
      changesBefore: before  as object,
      changesAfter:  updated as object,
    },
  });

  return updated;
}

export async function deleteContractor(contractorId: string, actor: RequestUser) {
  const contractor = await prisma.contractor.findFirst({
    where: { id: contractorId, companyId: actor.companyId },
    select: CONTRACTOR_SELECT,
  });
  if (!contractor) throw new NotFoundError('Contractor');

  // Soft-delete by setting isActive = false
  const updated = await prisma.contractor.update({
    where: { id: contractorId },
    data: { isActive: false },
    select: CONTRACTOR_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:     actor.companyId,
      userId:        actor.id,
      userEmail:     actor.email,
      userRole:      actor.role,
      action:        'delete',
      entityType:    'contractor',
      entityId:      contractorId,
      changesBefore: contractor as object,
      changesAfter:  updated    as object,
    },
  });
}
