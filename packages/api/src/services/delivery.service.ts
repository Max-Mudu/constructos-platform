import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../utils/errors';
import { RequestUser } from '../types';
import { getAccessibleSiteIds } from '../middleware/requireProjectAccess';
import { DeliveryCondition, InspectionStatus, AcceptanceStatus, Prisma } from '@prisma/client';
import { emitToCompany } from './event-emitter.service';
import * as inventoryService from './inventory.service';

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

const DELIVERY_LIST_SELECT = {
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
} as const;

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

const ACCEPTED_STATES: ReadonlyArray<AcceptanceStatus | null> = ['accepted', 'partially_accepted'];

/**
 * Once a delivery's goods have been added to site stock (it has a delivery_in
 * transaction), moving it from an accepted state to rejected, or changing the
 * quantity, item or unit the credit was based on, would leave stock disagreeing
 * with the delivery. Such a change is refused; a company admin or project
 * manager corrects stock with a stock adjustment instead. Values that are sent
 * unchanged (the web edit form sends every field) are not a change. The caller
 * holds the delivery's row lock.
 */
async function assertStockStaysConsistent(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  companyId: string,
  input: UpdateDeliveryInput,
): Promise<void> {
  const touchesStock =
    input.acceptanceStatus === 'rejected' ||
    input.quantityDelivered !== undefined ||
    input.itemDescription   !== undefined ||
    input.unitOfMeasure     !== undefined;
  if (!touchesStock) return;

  const credited = await tx.inventoryTransaction.count({
    where: { deliveryId, companyId, type: 'delivery_in' },
  });
  if (credited === 0) return;

  const current = await tx.deliveryRecord.findUniqueOrThrow({
    where:  { id: deliveryId },
    select: { acceptanceStatus: true, quantityDelivered: true, itemDescription: true, unitOfMeasure: true },
  });

  if (input.acceptanceStatus === 'rejected' && ACCEPTED_STATES.includes(current.acceptanceStatus)) {
    throw new ConflictError(
      'This delivery\'s goods have already been added to site stock, so it can no longer be marked rejected. ' +
      'To take returned goods out of stock, a company admin or project manager records a stock adjustment.',
    );
  }

  const changed =
    (input.quantityDelivered !== undefined &&
      !current.quantityDelivered.equals(new Prisma.Decimal(input.quantityDelivered))) ||
    (input.itemDescription !== undefined &&
      input.itemDescription.trim() !== current.itemDescription.trim()) ||
    (input.unitOfMeasure !== undefined &&
      input.unitOfMeasure.trim() !== current.unitOfMeasure.trim());
  if (changed) {
    throw new ConflictError(
      'The delivered quantity, item and unit of a delivery cannot be changed after its goods were added to site stock. ' +
      'To correct stock, a company admin or project manager records a stock adjustment.',
    );
  }
}

/**
 * Partial acceptance cannot record how much of a delivery was accepted yet,
 * and accepting would credit site stock with the full delivered quantity.
 * Until the accepted quantity can be recorded, moving a delivery with a
 * delivered quantity above zero into partially_accepted is refused. A delivery
 * that is already partially_accepted is left as it is (the web edit form
 * re-sends its status unchanged).
 */
const PARTIAL_ACCEPTANCE_UNAVAILABLE =
  'Partial acceptance cannot be recorded yet: the accepted quantity cannot be entered, ' +
  'and site stock would be credited with the full delivered quantity. ' +
  'Mark the delivery accepted if all delivered goods were accepted; otherwise leave it pending ' +
  'and describe the shortfall in the discrepancy notes.';

function assertPartialAcceptanceAllowed(
  requested: AcceptanceStatus | null | undefined,
  current: AcceptanceStatus | null,
  quantityDelivered: Prisma.Decimal | number,
): void {
  if (requested !== 'partially_accepted' || current === 'partially_accepted') return;
  if (new Prisma.Decimal(quantityDelivered).greaterThan(0)) {
    throw new ConflictError(PARTIAL_ACCEPTANCE_UNAVAILABLE);
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
    select: DELIVERY_LIST_SELECT,
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
  assertPartialAcceptanceAllowed(input.acceptanceStatus, null, input.quantityDelivered);
  await validateReceivedBy(input.receivedById, actor.companyId);
  if (input.budgetLineItemId) {
    await validateBudgetLineItemScope(input.budgetLineItemId, actor.companyId, projectId);
  }
  if (input.supplierInvoiceId) {
    await validateSupplierInvoiceScope(input.supplierInvoiceId, actor.companyId, projectId);
  }

  // The delivery, its audit row and (when it is created already accepted) the
  // inventory credit commit together, so a failure part-way leaves neither an
  // unaudited delivery nor an accepted delivery whose goods are not in stock.
  const record = await prisma.$transaction(async (tx) => {
    const created = await tx.deliveryRecord.create({
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
        acceptanceStatus: input.acceptanceStatus ?? null,
        rejectionReason: input.rejectionReason,
        discrepancyNotes: input.discrepancyNotes,
        receivedById: input.receivedById,
        budgetLineItemId: input.budgetLineItemId,
        supplierInvoiceId: input.supplierInvoiceId,
        comments: input.comments,
      },
      select: DELIVERY_SELECT,
    });

    await tx.auditLog.create({
      data: {
        companyId: actor.companyId,
        userId: actor.id,
        userEmail: actor.email,
        userRole: actor.role,
        action: 'create',
        entityType: 'delivery_record',
        entityId: created.id,
        changesAfter: created as object,
      },
    });

    // Credit inventory immediately when delivery is created already-accepted.
    const createdAccepted =
      created.acceptanceStatus === 'accepted' ||
      created.acceptanceStatus === 'partially_accepted';

    if (createdAccepted) {
      await inventoryService.creditFromDelivery(created, actor.id, tx);
    }

    return created;
  });

  // Sent only once the delivery is saved, so no client is told about a
  // delivery that was rolled back.
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

  const exists = await prisma.deliveryRecord.findFirst({
    where: { id: deliveryId, projectId, siteId, companyId: actor.companyId },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError('Delivery record');

  if (input.budgetLineItemId != null) {
    await validateBudgetLineItemScope(input.budgetLineItemId, actor.companyId, projectId);
  }
  if (input.supplierInvoiceId != null) {
    await validateSupplierInvoiceScope(input.supplierInvoiceId, actor.companyId, projectId);
  }

  const data = {
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
  };

  const acceptsDelivery =
    input.acceptanceStatus === 'accepted' ||
    input.acceptanceStatus === 'partially_accepted';

  // The update, its audit row and the inventory credit commit together.
  // Inventory is credited once, when the delivery moves into an accepted
  // state. A request that accepts the delivery therefore writes conditionally:
  // the update only matches while the delivery is not yet accepted, so of
  // several concurrent accepts exactly one makes the transition and credits
  // inventory. The others wait on the row lock, find the delivery already
  // accepted and apply their update without crediting again.
  return prisma.$transaction(async (tx) => {
    // Lock the delivery row first, so the stock check below and the update
    // see the same delivery: a concurrent accept either commits before this
    // check (and the check sees its credit) or waits until this one commits.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "delivery_records"
      WHERE "id" = ${deliveryId} AND "projectId" = ${projectId}
        AND "siteId" = ${siteId} AND "companyId" = ${actor.companyId}
      FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError('Delivery record');
    await assertStockStaysConsistent(tx, deliveryId, actor.companyId, input);

    // Read for the audit row while holding the lock, so "before" is the
    // state this update really replaced, also when two updates overlap.
    const before = await tx.deliveryRecord.findUniqueOrThrow({
      where:  { id: deliveryId },
      select: DELIVERY_SELECT,
    });
    assertPartialAcceptanceAllowed(
      input.acceptanceStatus,
      before.acceptanceStatus,
      input.quantityDelivered ?? before.quantityDelivered,
    );

    let justAccepted = false;
    if (acceptsDelivery) {
      const res = await tx.deliveryRecord.updateMany({
        where: {
          id: deliveryId, projectId, siteId, companyId: actor.companyId,
          OR: [
            { acceptanceStatus: null },
            { acceptanceStatus: { notIn: ['accepted', 'partially_accepted'] } },
          ],
        },
        data,
      });
      justAccepted = res.count === 1;
    }

    const updated = justAccepted
      ? await tx.deliveryRecord.findUniqueOrThrow({
          where:  { id: deliveryId },
          select: DELIVERY_SELECT,
        })
      : await tx.deliveryRecord.update({
          where:  { id: deliveryId },
          data,
          select: DELIVERY_SELECT,
        });

    await tx.auditLog.create({
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

    // A delivery adds its goods to stock once. A credited delivery can no
    // longer be moved to rejected (see assertStockStaysConsistent); one that
    // was rejected after acceptance before that rule keeps its earlier credit
    // when accepted again. The row lock taken at the start of this transaction
    // makes this check and the credit safe against concurrent requests.
    if (justAccepted) {
      const earlierCredits = await tx.inventoryTransaction.count({
        where: { deliveryId, companyId: actor.companyId, type: 'delivery_in' },
      });
      if (earlierCredits === 0) {
        await inventoryService.creditFromDelivery(updated, actor.id, tx);
      }
    }

    return updated;
  });
}

export async function deleteDelivery(
  deliveryId: string,
  projectId: string,
  siteId: string,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  // The check, the delete and its audit row commit together under the same
  // row lock updateDelivery takes, so a delete racing an accept either runs
  // first (the accept then finds no delivery and credits nothing) or sees the
  // accept's credit and is refused.
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "delivery_records"
      WHERE "id" = ${deliveryId} AND "projectId" = ${projectId}
        AND "siteId" = ${siteId} AND "companyId" = ${actor.companyId}
      FOR UPDATE`;
    if (locked.length === 0) throw new NotFoundError('Delivery record');

    // A delivery whose goods were added to site stock stays, with its photos,
    // documents, stock transaction and audit history. Stock is not reversed
    // here; a company admin or project manager corrects it with a stock
    // adjustment.
    const credited = await tx.inventoryTransaction.count({
      where: { deliveryId, companyId: actor.companyId, type: 'delivery_in' },
    });
    if (credited > 0) {
      throw new ConflictError(
        'This delivery\'s goods have already been added to site stock, so it cannot be deleted. ' +
        'The delivery record is kept. To correct stock, a company admin or project manager records a stock adjustment.',
      );
    }

    const record = await tx.deliveryRecord.findUniqueOrThrow({
      where:  { id: deliveryId },
      select: DELIVERY_SELECT,
    });

    await tx.deliveryRecord.delete({ where: { id: deliveryId } });

    await tx.auditLog.create({
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
  });
}
