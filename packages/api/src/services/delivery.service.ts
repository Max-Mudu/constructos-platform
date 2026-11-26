import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../utils/errors';
import { RequestUser } from '../types';
import { getAccessibleSiteIds, passesProjectRouteGuards } from '../middleware/requireProjectAccess';
import { DeliveryCondition, InspectionStatus, AcceptanceStatus, Prisma } from '@prisma/client';
import { emitToReaders } from './event-emitter.service';
import * as inventoryService from './inventory.service';

// ─── Read roles ───────────────────────────────────────────────────────────────

/** Roles that can view deliveries (read-only: finance, viewer; write: supervisor/pm/admin). */
export const DELIVERY_VIEW_ROLES = ['company_admin', 'project_manager', 'site_supervisor', 'finance_officer', 'viewer'] as const;

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
  quantityAccepted?: number;
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
  quantityAccepted?: number | null;
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
  quantityAccepted: true,
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
  quantityAccepted: true,
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
    input.acceptanceStatus  !== undefined ||
    input.quantityDelivered !== undefined ||
    input.quantityAccepted  !== undefined ||
    input.itemDescription   !== undefined ||
    input.unitOfMeasure     !== undefined;
  if (!touchesStock) return;

  const credited = await tx.inventoryTransaction.count({
    where: { deliveryId, companyId, type: 'delivery_in' },
  });
  if (credited === 0) return;

  const current = await tx.deliveryRecord.findUniqueOrThrow({
    where:  { id: deliveryId },
    select: {
      acceptanceStatus: true, quantityDelivered: true, quantityAccepted: true,
      itemDescription: true, unitOfMeasure: true,
    },
  });

  if (input.acceptanceStatus === 'rejected' && ACCEPTED_STATES.includes(current.acceptanceStatus)) {
    throw new ConflictError(
      'This delivery\'s goods have already been added to site stock, so it can no longer be marked rejected. ' +
      'To take returned goods out of stock, a company admin or project manager records a stock adjustment.',
    );
  }

  // Full and partial acceptance credit different quantities, so switching
  // between them after the credit would need stock added or taken back.
  // Neither happens implicitly.
  const switchesAcceptance =
    input.acceptanceStatus !== undefined &&
    input.acceptanceStatus !== current.acceptanceStatus &&
    (input.acceptanceStatus === 'partially_accepted' || current.acceptanceStatus === 'partially_accepted');
  if (switchesAcceptance) {
    throw new ConflictError(
      'This delivery\'s goods have already been added to site stock at the quantity accepted then, ' +
      'so it cannot be switched between accepted and partially accepted. ' +
      'To correct stock, a company admin or project manager records a stock adjustment.',
    );
  }

  const acceptedChanged =
    input.quantityAccepted !== undefined &&
    (input.quantityAccepted === null
      ? current.quantityAccepted !== null
      : current.quantityAccepted === null ||
        !current.quantityAccepted.equals(new Prisma.Decimal(input.quantityAccepted)));

  const changed =
    acceptedChanged ||
    (input.quantityDelivered !== undefined &&
      !current.quantityDelivered.equals(new Prisma.Decimal(input.quantityDelivered))) ||
    (input.itemDescription !== undefined &&
      input.itemDescription.trim() !== current.itemDescription.trim()) ||
    (input.unitOfMeasure !== undefined &&
      input.unitOfMeasure.trim() !== current.unitOfMeasure.trim());
  if (changed) {
    throw new ConflictError(
      'The delivered quantity, accepted quantity, item and unit of a delivery cannot be changed after its goods were added to site stock. ' +
      'To correct stock, a company admin or project manager records a stock adjustment.',
    );
  }
}

/**
 * The accepted quantity of a delivery. A partially accepted delivery of goods
 * records how much of the delivered quantity was accepted: more than 0 and
 * less than the delivered quantity (all of it is "accepted"). It is stored
 * separately from the delivered quantity and is the quantity added to stock.
 * Any other status carries no accepted quantity. `required` is false only for
 * a delivery that is already partially accepted, so records made before the
 * accepted quantity existed ("accepted quantity not recorded") stay editable
 * without one being guessed.
 */
function validateAcceptedQuantity(
  status: AcceptanceStatus | null,
  quantityDelivered: Prisma.Decimal,
  quantityAccepted: Prisma.Decimal | null,
  required: boolean,
): void {
  if (status !== 'partially_accepted') {
    if (quantityAccepted !== null) {
      throw new ValidationError('An accepted quantity is recorded only for a partially accepted delivery.');
    }
    return;
  }
  if (!quantityDelivered.greaterThan(0)) {
    if (quantityAccepted !== null) {
      throw new ValidationError('Nothing was delivered, so no accepted quantity can be recorded.');
    }
    return;
  }
  if (quantityAccepted === null) {
    if (required) {
      throw new ValidationError(
        'Enter the quantity accepted for a partially accepted delivery: more than 0 and less than the delivered quantity.',
      );
    }
    return;
  }
  if (!quantityAccepted.greaterThan(0) || !quantityAccepted.lessThan(quantityDelivered)) {
    throw new ValidationError(
      `The accepted quantity must be more than 0 and less than the delivered quantity (${quantityDelivered.toString()}). ` +
      'If all delivered goods were accepted, mark the delivery accepted.',
    );
  }
}

const toDecimal = (v: number | null | undefined): Prisma.Decimal | null =>
  v === null || v === undefined ? null : new Prisma.Decimal(v);

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

/**
 * True when `reader` could GET this delivery: the route guards
 * (DELIVERY_VIEW_ROLES, requireProjectAccess), then getDelivery's own rules.
 */
export async function canReadDelivery(
  reader: RequestUser,
  deliveryId: string,
  projectId: string,
  siteId: string,
): Promise<boolean> {
  if (!(await passesProjectRouteGuards(reader, DELIVERY_VIEW_ROLES, projectId))) return false;
  try {
    await getDelivery(deliveryId, projectId, siteId, reader);
    return true;
  } catch {
    return false;
  }
}

export async function createDelivery(
  projectId: string,
  siteId: string,
  input: CreateDeliveryInput,
  actor: RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);
  validateAcceptedQuantity(
    input.acceptanceStatus ?? null,
    new Prisma.Decimal(input.quantityDelivered),
    toDecimal(input.quantityAccepted),
    true,
  );
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
        quantityAccepted: input.quantityAccepted ?? null,
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
  // delivery that was rolled back; only to users who can read it.
  emitToReaders(actor.companyId, {
    type: 'delivery_created',
    payload: { deliveryId: record.id, projectId, siteId },
  }, (reader) => canReadDelivery(reader, record.id, projectId, siteId));

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
    ...(input.quantityAccepted    !== undefined && { quantityAccepted: input.quantityAccepted }),
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
    // Checked against the stored delivery, so a request that changes only the
    // delivered or the accepted quantity is validated against the other one.
    const targetStatus = input.acceptanceStatus ?? before.acceptanceStatus;
    const entersPartial =
      targetStatus === 'partially_accepted' && before.acceptanceStatus !== 'partially_accepted';
    validateAcceptedQuantity(
      targetStatus,
      input.quantityDelivered !== undefined
        ? new Prisma.Decimal(input.quantityDelivered)
        : before.quantityDelivered,
      input.quantityAccepted !== undefined
        ? toDecimal(input.quantityAccepted)
        : targetStatus === 'partially_accepted' ? before.quantityAccepted : null,
      entersPartial,
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
