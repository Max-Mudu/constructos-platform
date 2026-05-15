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
  id:            true,
  type:          true,
  quantity:      true,
  unitOfMeasure: true,
  note:          true,
  createdAt:     true,
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
  console.log('[creditFromDelivery] entry — deliveryId:', delivery.id, '| qty:', qty, '| materialName:', delivery.itemDescription, '| siteId:', delivery.siteId, '| companyId:', delivery.companyId);

  if (!qty || qty <= 0) {
    console.log('[creditFromDelivery] early return — qty is zero or negative:', qty);
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

    console.log('[creditFromDelivery] upsert result — inventoryId:', inventoryItem.id, '| newQty:', String(inventoryItem.currentQuantity));

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

    console.log('[creditFromDelivery] transaction committed — inventory credited');
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
  projectId:   string,
  siteId:      string,
  inventoryId: string,
  quantity:    number,
  note:        string | undefined,
  actor:       RequestUser,
) {
  await checkSiteAccess(siteId, projectId, actor);

  console.log('[inventory-usage] request — inventoryId:', inventoryId, '| qty:', quantity, '| actor:', actor.id);

  const item = await prisma.siteInventory.findFirst({
    where: { id: inventoryId, siteId, companyId: actor.companyId },
  });
  if (!item) throw new NotFoundError('Inventory item');

  const current = Number(item.currentQuantity);
  if (quantity > current) {
    console.log('[inventory-usage] insufficient stock — requested:', quantity, '| available:', current);
    throw new ValidationError(`Insufficient stock: requested ${quantity}, available ${current}`);
  }

  const negativeQty = new Prisma.Decimal(-quantity);

  const updated = await prisma.$transaction(async (tx) => {
    const decremented = await tx.siteInventory.update({
      where:  { id: inventoryId },
      data:   { currentQuantity: { decrement: quantity } },
      select: INVENTORY_ITEM_SELECT,
    });

    console.log('[inventory-usage] decrement success — newQty:', String(decremented.currentQuantity));

    await tx.inventoryTransaction.create({
      data: {
        companyId:     actor.companyId,
        siteId,
        inventoryId,
        type:          'usage_out',
        quantity:      negativeQty,
        unitOfMeasure: item.unitOfMeasure,
        note:          note ?? null,
        performedById: actor.id,
      },
    });

    console.log('[inventory-usage] transaction committed — inventoryId:', inventoryId);

    return decremented;
  });

  const isLow = computeIsLowStock(updated.currentQuantity, updated.lowStockThreshold);
  if (isLow) {
    console.log(
      '[inventory-alert] low stock —',
      'material:', updated.materialName,
      '| currentQuantity:', String(updated.currentQuantity),
      '| threshold:', String(updated.lowStockThreshold),
      '| siteId:', siteId,
    );
  }

  return { ...updated, isLowStock: isLow };
}
