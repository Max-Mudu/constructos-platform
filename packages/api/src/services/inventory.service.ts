import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma';
import { NotFoundError, ValidationError } from '../utils/errors';
import { RequestUser } from '../types';
import { getAccessibleSiteIds } from '../middleware/requireProjectAccess';

// ─── Select shapes ────────────────────────────────────────────────────────────

const INVENTORY_ITEM_SELECT = {
  id:                true,
  companyId:         true,
  siteId:            true,
  materialName:      true,
  unitOfMeasure:     true,
  currentQuantity:   true,
  lowStockThreshold: true,
  createdAt:         true,
  updatedAt:         true,
  site: {
    select: { id: true, name: true },
  },
} as const;

const TRANSACTION_SELECT = {
  id:             true,
  type:           true,
  quantity:       true,
  unitOfMeasure:  true,
  note:           true,
  usageReason:    true,
  workArea:       true,
  scheduleTaskId: true,
  createdAt:      true,
  delivery: {
    select: { id: true, supplierName: true, deliveryDate: true },
  },
  performedBy: {
    select: { id: true, firstName: true, lastName: true },
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function computeIsLowStock(
  currentQuantity:   Prisma.Decimal,
  lowStockThreshold: Prisma.Decimal | null,
): boolean {
  if (lowStockThreshold === null) return false;
  return currentQuantity.lte(lowStockThreshold);
}

async function checkSiteAccess(
  siteId:    string,
  projectId: string,
  actor:     RequestUser,
): Promise<void> {
  const accessibleSiteIds = await getAccessibleSiteIds(projectId, actor.id, actor.role);
  if (accessibleSiteIds !== null && !accessibleSiteIds.includes(siteId)) {
    throw new NotFoundError('Site');
  }
}

// ─── Inventory credit ─────────────────────────────────────────────────────────

export async function creditFromDelivery(
  delivery: {
    id:                string;
    companyId:         string;
    siteId:            string;
    itemDescription:   string;
    unitOfMeasure:     string;
    quantityDelivered: Prisma.Decimal;
  },
  actorId?: string,
): Promise<void> {
  const qty = Number(delivery.quantityDelivered);

  if (!qty || qty <= 0) {
    return;
  }

  const materialName  = delivery.itemDescription.trim();
  const unitOfMeasure = delivery.unitOfMeasure.trim() || 'unit';

  await prisma.$transaction(async (tx) => {
    const inventoryItem = await tx.siteInventory.upsert({
      where: {
        siteId_materialName_unitOfMeasure: {
          siteId: delivery.siteId,
          materialName,
          unitOfMeasure,
        },
      },
      create: {
        companyId:       delivery.companyId,
        siteId:          delivery.siteId,
        materialName,
        unitOfMeasure,
        currentQuantity: delivery.quantityDelivered,
      },
      update: {
        currentQuantity: { increment: delivery.quantityDelivered },
      },
      select: { id: true, currentQuantity: true },
    });

    await tx.inventoryTransaction.create({
      data: {
        companyId:     delivery.companyId,
        siteId:        delivery.siteId,
        inventoryId:   inventoryItem.id,
        deliveryId:    delivery.id,
        type:          'delivery_in',
        quantity:      delivery.quantityDelivered,
        unitOfMeasure,
        note:          null,
        performedById: actorId ?? null,
      },
    });
  });
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function listInventory(
  projectId: string,
  siteId:    string,
  actor:     RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const items = await prisma.siteInventory.findMany({
    where:   { siteId, companyId: actor.companyId },
    select:  INVENTORY_ITEM_SELECT,
    orderBy: { materialName: 'asc' },
  });
  return items.map((item) => ({
    ...item,
    isLowStock: computeIsLowStock(item.currentQuantity, item.lowStockThreshold),
  }));
}

export async function getInventoryItem(
  projectId:   string,
  siteId:      string,
  inventoryId: string,
  actor:       RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const item = await prisma.siteInventory.findFirst({
    where:  { id: inventoryId, siteId, companyId: actor.companyId },
    select: INVENTORY_ITEM_SELECT,
  });
  if (!item) throw new NotFoundError('Inventory item');

  const transactions = await prisma.inventoryTransaction.findMany({
    where:   { inventoryId, companyId: actor.companyId },
    select:  TRANSACTION_SELECT,
    orderBy: { createdAt: 'desc' },
    take:    50,
  });

  return {
    ...item,
    isLowStock: computeIsLowStock(item.currentQuantity, item.lowStockThreshold),
    transactions,
  };
}

// ─── Usage deduction ──────────────────────────────────────────────────────────

export async function recordUsage(
  projectId:      string,
  siteId:         string,
  inventoryId:    string,
  quantity:       number,
  note:           string | undefined,
  usageReason:    string | undefined,
  workArea:       string | undefined,
  scheduleTaskId: string | undefined,
  actor:          RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const item = await prisma.siteInventory.findFirst({
    where: { id: inventoryId, siteId, companyId: actor.companyId },
  });
  if (!item) throw new NotFoundError('Inventory item');

  const current = Number(item.currentQuantity);
  if (quantity > current) {
    throw new ValidationError(`Insufficient stock: requested ${quantity}, available ${current}`);
  }

  const negativeQty = new Prisma.Decimal(-quantity);

  const updated = await prisma.$transaction(async (tx) => {
    const decremented = await tx.siteInventory.update({
      where:  { id: inventoryId },
      data:   { currentQuantity: { decrement: quantity } },
      select: INVENTORY_ITEM_SELECT,
    });

    await tx.inventoryTransaction.create({
      data: {
        companyId:      actor.companyId,
        siteId,
        inventoryId,
        type:           'usage_out',
        quantity:       negativeQty,
        unitOfMeasure:  item.unitOfMeasure,
        note:           note           ?? null,
        usageReason:    usageReason    ?? null,
        workArea:       workArea       ?? null,
        scheduleTaskId: scheduleTaskId ?? null,
        performedById:  actor.id,
      },
    });

    return decremented;
  });

  const isLow = computeIsLowStock(updated.currentQuantity, updated.lowStockThreshold);
  if (isLow) {
    console.warn('[inventory] low stock — material:', updated.materialName, '| qty:', String(updated.currentQuantity), '| threshold:', String(updated.lowStockThreshold), '| siteId:', siteId);
  }

  return { ...updated, isLowStock: isLow };
}

// ─── Stock adjustment ─────────────────────────────────────────────────────────

export const ADJUSTMENT_REASONS = [
  'stock_count_correction',
  'damaged',
  'lost_or_stolen',
  'returned_to_supplier',
  'found',
  'data_entry_error',
  'other',
] as const;

export type AdjustmentReason = typeof ADJUSTMENT_REASONS[number];
export type AdjustmentDirection = 'in' | 'out';

/** Largest value a Decimal(12,3) column holds. */
const MAX_STOCK = new Prisma.Decimal('999999999.999');

/**
 * Corrects the book stock of one inventory item up or down, recording an
 * adjustment_in / adjustment_out transaction (reason in usageReason, actor in
 * performedById) and an audit row with the before and after quantities.
 *
 * The stock change is a conditional update inside the transaction: an `out`
 * only matches while currentQuantity >= quantity, so concurrent adjustments
 * cannot take stock below zero, and an `in` cannot overflow the column.
 */
export async function adjustStock(
  projectId:   string,
  siteId:      string,
  inventoryId: string,
  input: {
    direction: AdjustmentDirection;
    quantity:  number;
    reason:    AdjustmentReason;
    note?:     string;
  },
  actor:   RequestUser,
  request: { ip?: string; userAgent?: string } = {},
) {
  await checkSiteAccess(siteId, projectId, actor);

  const item = await prisma.siteInventory.findFirst({
    where:  { id: inventoryId, siteId, companyId: actor.companyId },
    select: { id: true, unitOfMeasure: true },
  });
  if (!item) throw new NotFoundError('Inventory item');

  const qty  = new Prisma.Decimal(input.quantity);
  const isIn = input.direction === 'in';
  const note = input.note?.trim() ? input.note.trim() : null;

  const updated = await prisma.$transaction(async (tx) => {
    const where: Prisma.SiteInventoryWhereInput = {
      id: inventoryId, siteId, companyId: actor.companyId,
      currentQuantity: isIn ? { lte: MAX_STOCK.minus(qty) } : { gte: qty },
    };
    const res = await tx.siteInventory.updateMany({
      where,
      data: { currentQuantity: isIn ? { increment: qty } : { decrement: qty } },
    });

    if (res.count === 0) {
      const current = await tx.siteInventory.findFirst({
        where:  { id: inventoryId, siteId, companyId: actor.companyId },
        select: { currentQuantity: true },
      });
      if (!current) throw new NotFoundError('Inventory item');
      if (isIn) {
        throw new ValidationError('Adjustment would exceed the maximum stock quantity');
      }
      throw new ValidationError(
        `Insufficient stock: requested ${qty.toString()}, available ${current.currentQuantity.toString()}`,
      );
    }

    // Our update holds the row lock until commit, so this read is the
    // post-adjustment value and nothing else has changed it in between.
    const after = await tx.siteInventory.findFirstOrThrow({
      where:  { id: inventoryId },
      select: INVENTORY_ITEM_SELECT,
    });
    const beforeQty = isIn ? after.currentQuantity.minus(qty) : after.currentQuantity.plus(qty);

    const txRow = await tx.inventoryTransaction.create({
      data: {
        companyId:     actor.companyId,
        siteId,
        inventoryId,
        type:          isIn ? 'adjustment_in' : 'adjustment_out',
        quantity:      isIn ? qty : qty.negated(),
        unitOfMeasure: item.unitOfMeasure,
        note,
        usageReason:   input.reason,
        performedById: actor.id,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        companyId:     actor.companyId,
        userId:        actor.id,
        userEmail:     actor.email,
        userRole:      actor.role,
        action:        'update',
        entityType:    'site_inventory',
        entityId:      inventoryId,
        changesBefore: { currentQuantity: beforeQty.toString() },
        changesAfter:  {
          currentQuantity: after.currentQuantity.toString(),
          adjustment: {
            transactionId: txRow.id,
            direction:     input.direction,
            quantity:      qty.toString(),
            reason:        input.reason,
            note,
          },
        },
        ipAddress: request.ip ?? null,
        userAgent: request.userAgent ?? null,
      },
    });

    return after;
  });

  const isLow = computeIsLowStock(updated.currentQuantity, updated.lowStockThreshold);
  if (isLow) {
    console.warn('[inventory] low stock — material:', updated.materialName, '| qty:', String(updated.currentQuantity), '| threshold:', String(updated.lowStockThreshold), '| siteId:', siteId);
  }

  return { ...updated, isLowStock: isLow };
}

// ─── Threshold management ─────────────────────────────────────────────────────

export async function updateThreshold(
  projectId:   string,
  siteId:      string,
  inventoryId: string,
  threshold:   number | null,
  actor:       RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  const existing = await prisma.siteInventory.findFirst({
    where:  { id: inventoryId, siteId, companyId: actor.companyId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('Inventory item');

  const updated = await prisma.siteInventory.update({
    where:  { id: inventoryId },
    data:   { lowStockThreshold: threshold !== null ? new Prisma.Decimal(threshold) : null },
    select: INVENTORY_ITEM_SELECT,
  });

  return {
    ...updated,
    isLowStock: computeIsLowStock(updated.currentQuantity, updated.lowStockThreshold),
  };
}
