import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { RequestUser } from '../types';
import { getAccessibleSiteIds } from '../middleware/requireProjectAccess';
import { DeliveryCondition, InspectionStatus, AcceptanceStatus } from '@prisma/client';
import { emitToCompany } from './event-emitter.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateDeliveryInput {
  supplierName: string;
  supplierContact?: string;
  deliveryDate: string;          // ISO date "YYYY-MM-DD"
  deliveryTime?: string;         // "HH:MM"
  driverName?: string;
  vehicleRegistration?: string;
  purchaseOrderNumber?: string;
  deliveryNoteNumber?: string;
  invoiceNumber?: string;
  itemDescription: string;
  unitOfMeasure: string;
  quantityOrdered: number;
  quantityDelivered: number;
  conditionOnArrival?: DeliveryCondition;
  inspectionStatus?: InspectionStatus;
  acceptanceStatus?: AcceptanceStatus;
  rejectionReason?: string;
  discrepancyNotes?: string;
  receivedById: string;
  budgetLineItemId?: string;
  supplierInvoiceId?: string;
  comments?: string;
}

export interface UpdateDeliveryInput {
  supplierName?: string;
  supplierContact?: string | null;
  deliveryDate?: string;
  deliveryTime?: string | null;
  driverName?: string | null;
  vehicleRegistration?: string | null;
  purchaseOrderNumber?: string | null;
  deliveryNoteNumber?: string | null;
  invoiceNumber?: string | null;
  itemDescription?: string;
  unitOfMeasure?: string;
  quantityOrdered?: number;
  quantityDelivered?: number;
  conditionOnArrival?: DeliveryCondition;
  inspectionStatus?: InspectionStatus;
  acceptanceStatus?: AcceptanceStatus;
  rejectionReason?: string | null;
  discrepancyNotes?: string | null;
  budgetLineItemId?: string | null;
  supplierInvoiceId?: string | null;
  comments?: string | null;
}

// ─── Select ───────────────────────────────────────────────────────────────────

const DELIVERY_SELECT = {
  id: true,
  companyId: true,
  projectId: true,
  siteId: true,
  supplierName: true,
  supplierContact: true,
  deliveryDate: true,
  deliveryTime: true,
  driverName: true,
  vehicleRegistration: true,
  purchaseOrderNumber: true,
  deliveryNoteNumber: true,
  invoiceNumber: true,
  itemDescription: true,
  unitOfMeasure: true,
  quantityOrdered: true,
  quantityDelivered: true,
  conditionOnArrival: true,
  inspectionStatus: true,
  acceptanceStatus: true,
  rejectionReason: true,
  discrepancyNotes: true,
  receivedById: true,
  budgetLineItemId: true,
  supplierInvoiceId: true,
  comments: true,
  createdAt: true,
  updatedAt: true,
  receivedBy: {
    select: { id: true, firstName: true, lastName: true, email: true },
  },
  photos: {
    select: {
      id: true,
      fileUrl: true,
      fileName: true,
      fileSizeBytes: true,
      uploadedById: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
  documents: {
    select: {
      id: true,
      fileUrl: true,
      fileName: true,
      fileSizeBytes: true,
      fileType: true,
      uploadedById: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validates that the receivedById user belongs to the same company.
 * Throws ForbiddenError if not found.
 */
async function validateReceivedBy(receivedById: string, companyId: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: receivedById, companyId },
    select: { id: true },
  });
  if (!user) {
    throw new ForbiddenError('receivedById must be a user in your company');
  }
}

/**
 * Validates that a budgetLineItemId belongs to the same company and project.
 * Throws ValidationError if not found / out of scope.
 */
async function validateBudgetLineItemScope(
  budgetLineItemId: string,
  companyId: string,
  projectId: string,
): Promise<void> {
  const item = await prisma.budgetLineItem.findFirst({
    where: { id: budgetLineItemId, companyId, projectId },
    select: { id: true },
  });
  if (!item) {
    throw new ValidationError('budgetLineItemId does not exist in this project');
  }
}

/**
 * Validates that a supplierInvoiceId belongs to the same company and project.
 * Throws ValidationError if not found / out of scope.
 */
async function validateSupplierInvoiceScope(
  supplierInvoiceId: string,
  companyId: string,
  projectId: string,
): Promise<void> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: supplierInvoiceId, companyId, projectId },
    select: { id: true },
  });
  if (!invoice) {
    throw new ValidationError('supplierInvoiceId does not exist in this project');
  }
}

/**
 * Checks site access for the actor and throws NotFoundError if denied.
 */
async function checkSiteAccess(
  siteId: string,
  projectId: string,
  actor: RequestUser,
): Promise<void> {
  const accessibleSiteIds = await getAccessibleSiteIds(projectId, actor.id, actor.role);
  if (accessibleSiteIds !== null && !accessibleSiteIds.includes(siteId)) {
    throw new NotFoundError('Delivery record');
  }
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function listDeliveries(
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  return prisma.deliveryRecord.findMany({
    where: { projectId, siteId, companyId: actor.companyId },
    select: DELIVERY_SELECT,
    orderBy: [{ deliveryDate: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function getDelivery(
  deliveryId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const record = await prisma.deliveryRecord.findFirst({
    where: { id: deliveryId, projectId, siteId, companyId: actor.companyId },
    select: DELIVERY_SELECT,
  });

  if (!record) throw new NotFoundError('Delivery record');
  return record;
}

export async function createDelivery(
  projectId: string,
  siteId: string,
  input: CreateDeliveryInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);
  await validateReceivedBy(input.receivedById, actor.companyId);
  if (input.budgetLineItemId) {
    await validateBudgetLineItemScope(input.budgetLineItemId, actor.companyId, projectId);
  }
  if (input.supplierInvoiceId) {
    await validateSupplierInvoiceScope(input.supplierInvoiceId, actor.companyId, projectId);
  }

  const record = await prisma.deliveryRecord.create({
    data: {
      companyId: actor.companyId,
      projectId,
      siteId,
      supplierName: input.supplierName,
      supplierContact: input.supplierContact,
      deliveryDate: new Date(input.deliveryDate),
      deliveryTime: input.deliveryTime,
      driverName: input.driverName,
      vehicleRegistration: input.vehicleRegistration,
      purchaseOrderNumber: input.purchaseOrderNumber,
      deliveryNoteNumber: input.deliveryNoteNumber,
      invoiceNumber: input.invoiceNumber,
      itemDescription: input.itemDescription,
      unitOfMeasure: input.unitOfMeasure,
      quantityOrdered: input.quantityOrdered,
      quantityDelivered: input.quantityDelivered,
      conditionOnArrival: input.conditionOnArrival ?? 'good',
      inspectionStatus: input.inspectionStatus ?? 'pending',
      acceptanceStatus: input.acceptanceStatus ?? 'accepted',
      rejectionReason: input.rejectionReason,
      discrepancyNotes: input.discrepancyNotes,
      receivedById: input.receivedById,
      budgetLineItemId: input.budgetLineItemId,
      supplierInvoiceId: input.supplierInvoiceId,
      comments: input.comments,
    },
    select: DELIVERY_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: 'create',
      entityType: 'delivery_record',
      entityId: record.id,
      changesAfter: record as object,
    },
  });

  emitToCompany(actor.companyId, {
    type: 'delivery_created',
    payload: { deliveryId: record.id, projectId, siteId, supplierName: record.supplierName },
  });

  return record;
}

export async function updateDelivery(
  deliveryId: string,
  projectId: string,
  siteId: string,
  input: UpdateDeliveryInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const before = await prisma.deliveryRecord.findFirst({
    where: { id: deliveryId, projectId, siteId, companyId: actor.companyId },
    select: DELIVERY_SELECT,
  });
  if (!before) throw new NotFoundError('Delivery record');

  if (input.budgetLineItemId != null) {
    await validateBudgetLineItemScope(input.budgetLineItemId, actor.companyId, projectId);
  }
  if (input.supplierInvoiceId != null) {
    await validateSupplierInvoiceScope(input.supplierInvoiceId, actor.companyId, projectId);
  }

  const updated = await prisma.deliveryRecord.update({
    where: { id: deliveryId },
    data: {
      ...(input.supplierName        !== undefined && { supplierName: input.supplierName }),
      ...(input.supplierContact     !== undefined && { supplierContact: input.supplierContact }),
      ...(input.deliveryDate        !== undefined && { deliveryDate: new Date(input.deliveryDate) }),
      ...(input.deliveryTime        !== undefined && { deliveryTime: input.deliveryTime }),
      ...(input.driverName          !== undefined && { driverName: input.driverName }),
      ...(input.vehicleRegistration !== undefined && { vehicleRegistration: input.vehicleRegistration }),
      ...(input.purchaseOrderNumber !== undefined && { purchaseOrderNumber: input.purchaseOrderNumber }),
      ...(input.deliveryNoteNumber  !== undefined && { deliveryNoteNumber: input.deliveryNoteNumber }),
      ...(input.invoiceNumber       !== undefined && { invoiceNumber: input.invoiceNumber }),
      ...(input.itemDescription     !== undefined && { itemDescription: input.itemDescription }),
      ...(input.unitOfMeasure       !== undefined && { unitOfMeasure: input.unitOfMeasure }),
      ...(input.quantityOrdered     !== undefined && { quantityOrdered: input.quantityOrdered }),
      ...(input.quantityDelivered   !== undefined && { quantityDelivered: input.quantityDelivered }),
      ...(input.conditionOnArrival  !== undefined && { conditionOnArrival: input.conditionOnArrival }),
      ...(input.inspectionStatus    !== undefined && { inspectionStatus: input.inspectionStatus }),
      ...(input.acceptanceStatus    !== undefined && { acceptanceStatus: input.acceptanceStatus }),
      ...(input.rejectionReason     !== undefined && { rejectionReason: input.rejectionReason }),
      ...(input.discrepancyNotes    !== undefined && { discrepancyNotes: input.discrepancyNotes }),
      ...(input.budgetLineItemId    !== undefined && { budgetLineItemId: input.budgetLineItemId }),
      ...(input.supplierInvoiceId   !== undefined && { supplierInvoiceId: input.supplierInvoiceId }),
      ...(input.comments            !== undefined && { comments: input.comments }),
    },
    select: DELIVERY_SELECT,
  });

  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: 'update',
      entityType: 'delivery_record',
      entityId: deliveryId,
      changesBefore: before as object,
      changesAfter: updated as object,
    },
  });

  return updated;
}

export async function deleteDelivery(
  deliveryId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const record = await prisma.deliveryRecord.findFirst({
    where: { id: deliveryId, projectId, siteId, companyId: actor.companyId },
    select: DELIVERY_SELECT,
  });
  if (!record) throw new NotFoundError('Delivery record');

  await prisma.deliveryRecord.delete({ where: { id: deliveryId } });

  await prisma.auditLog.create({
    data: {
      companyId: actor.companyId,
      userId: actor.id,
      userEmail: actor.email,
      userRole: actor.role,
      action: 'delete',
      entityType: 'delivery_record',
      entityId: deliveryId,
      changesBefore: record as object,
    },
  });
}
