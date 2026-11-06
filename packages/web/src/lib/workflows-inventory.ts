import type { InventoryTxType } from '@/lib/types';
import { formatQuantity } from '@/components/projects/format-quantity';

/**
 * Signed display of an inventory transaction quantity ("+500", "-5").
 *
 * The direction comes from the transaction type. usage_out rows are stored
 * with a negative quantity ("-5.000") while delivery_in rows are positive, so
 * prefixing the type's sign to the raw value printed "--5" for usage.
 */
export function formatTxQuantity(type: InventoryTxType, quantity: string | number): string {
  const sign = type.endsWith('_in') ? '+' : '-';
  const n = typeof quantity === 'number' ? quantity : Number(quantity);
  if (!Number.isFinite(n)) return `${sign}${quantity}`;
  return `${sign}${formatQuantity(Math.abs(n))}`;
}
