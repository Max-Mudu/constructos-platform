import { prisma } from '../utils/prisma';
import { NotFoundError } from '../utils/errors';
import { RequestUser } from '../types';

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface CreateSupplierInput {
  name:          string;
  contactPerson?: string;
  email?:         string;
  phone?:         string;
  address?:       string;
}

export interface UpdateSupplierInput {
  name?:          string;
  contactPerson?: string | null;
  email?:         string | null;
  phone?:         string | null;
  address?:       string | null;
  isActive?:      boolean;
}

// ─── Select ───────────────────────────────────────────────────────────────────

const SUPPLIER_SELECT = {
  id:            true,
  companyId:     true,
  name:          true,
  contactPerson: true,
  email:         true,
  phone:         true,
  address:       true,
  isActive:      true,
  createdAt:     true,
  updatedAt:     true,
} as const;

// ─── Service functions ────────────────────────────────────────────────────────

export async function listSuppliers(actor: RequestUser, includeInactive = false) {
  return prisma.supplier.findMany({
    where: {
      companyId: actor.companyId,
      ...(includeInactive ? {} : { isActive: true }),
    },
    select: SUPPLIER_SELECT,
    orderBy: { name: 'asc' },
  });
}

export async function getSupplier(supplierId: string, actor: RequestUser) {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, companyId: actor.companyId },
    select: SUPPLIER_SELECT,
  });
  if (!supplier) throw new NotFoundError('Supplier');
  return supplier;
}

export async function createSupplier(input: CreateSupplierInput, actor: RequestUser) {
  const supplier = await prisma.supplier.create({
    data: {
      companyId:     actor.companyId,
      name:          input.name,
      contactPerson: input.contactPerson,
      email:         input.email,
      phone:         input.phone,
      address:       input.address,
    },
    select: SUPPLIER_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:   actor.companyId,
      userId:      actor.id,
      userEmail:   actor.email,
      userRole:    actor.role,
      action:      'create',
      entityType:  'supplier',
      entityId:    supplier.id,
      changesAfter: supplier as object,
    },
  });

  return supplier;
}

export async function updateSupplier(
  supplierId: string,
  input: UpdateSupplierInput,
  actor: RequestUser,
) {
  const before = await prisma.supplier.findFirst({
    where: { id: supplierId, companyId: actor.companyId },
    select: SUPPLIER_SELECT,
  });
  if (!before) throw new NotFoundError('Supplier');

  const updated = await prisma.supplier.update({
    where: { id: supplierId },
    data: {
      ...(input.name          !== undefined && { name: input.name }),
      ...(input.contactPerson !== undefined && { contactPerson: input.contactPerson }),
      ...(input.email         !== undefined && { email: input.email }),
      ...(input.phone         !== undefined && { phone: input.phone }),
      ...(input.address       !== undefined && { address: input.address }),
      ...(input.isActive      !== undefined && { isActive: input.isActive }),
    },
    select: SUPPLIER_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'update',
      entityType:   'supplier',
      entityId:     supplierId,
      changesBefore: before as object,
      changesAfter:  updated as object,
    },
  });

  return updated;
}

export async function deleteSupplier(supplierId: string, actor: RequestUser) {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, companyId: actor.companyId },
    select: SUPPLIER_SELECT,
  });
  if (!supplier) throw new NotFoundError('Supplier');

  // Soft-delete: mark inactive rather than deleting the row
  // (deliveries reference supplier names as free text, so hard delete is safe,
  //  but soft-delete preserves history)
  const updated = await prisma.supplier.update({
    where: { id: supplierId },
    data:  { isActive: false },
    select: SUPPLIER_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId:    actor.companyId,
      userId:       actor.id,
      userEmail:    actor.email,
      userRole:     actor.role,
      action:       'delete',
      entityType:   'supplier',
      entityId:     supplierId,
      changesBefore: supplier as object,
      changesAfter:  updated as object,
    },
  });
}
