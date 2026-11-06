import type { LabourEntry } from '@/lib/types';

/** Wage for one labour entry: hours / 8 × daily rate (same rule as the list's Wage column). */
export function entryWage(entry: Pick<LabourEntry, 'hoursWorked' | 'dailyRate'>): number {
  return (Number(entry.hoursWorked) / 8) * Number(entry.dailyRate);
}

/**
 * Total labour cost per currency, in order of first appearance.
 *
 * Each entry's currency is its worker's, and the register offers several, so
 * one KES worker and one USD worker used to be summed into a single number
 * labelled with the first entry's currency.
 */
export function labourCostByCurrency(
  entries: Pick<LabourEntry, 'hoursWorked' | 'dailyRate' | 'currency'>[],
): { currency: string; total: number }[] {
  const totals = new Map<string, number>();
  for (const e of entries) {
    const w = entryWage(e);
    if (!Number.isFinite(w)) continue;
    const cur = e.currency ?? '';
    totals.set(cur, (totals.get(cur) ?? 0) + w);
  }
  return Array.from(totals, ([currency, total]) => ({ currency, total }));
}

/** "1,500 KES + 20 USD"; "0" when there is nothing to add up. */
export function formatLabourCost(totals: { currency: string; total: number }[]): string {
  if (totals.length === 0) return '0';
  return totals
    .map(({ currency, total }) => `${total.toLocaleString(undefined, { maximumFractionDigits: 0 })}${currency ? ` ${currency}` : ''}`)
    .join(' + ');
}

/**
 * Daily rate to pre-fill when the worker in the labour form changes. It used
 * to keep the previous worker's rate when the new one had no wage on record,
 * so the wrong wage was submitted (and saved, for finance users).
 */
export function rateForWorker(dailyWage: string | number | null | undefined): string {
  if (dailyWage === null || dailyWage === undefined || dailyWage === '') return '';
  const n = Number(dailyWage);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
}
