/**
 * Labour cost shown on the Labour tab ("Est. Cost").
 *
 * Same rule as the API (packages/api/src/utils/labour-cost.ts) and the web
 * Labour Register: every labour rate is a daily rate, so one entry costs
 *
 *   hoursWorked / 8 x dailyRate
 *
 * Totals are kept per currency and never added together. Entries whose rate
 * the API withheld (no finance visibility) are left out.
 *
 * Pure (no React Native imports) so it can be exercised with plain Node.
 */
export const HOURS_PER_DAY = 8;

export interface LabourCostEntry {
  hoursWorked: number | string;
  dailyRate?: number | string | null;
  currency?: string | null;
}

export interface LabourCostTotal {
  currency: string;
  total: number;
}

/** One total per currency, sorted by currency code. */
export function labourCostTotals(entries: ReadonlyArray<LabourCostEntry>): LabourCostTotal[] {
  const totals = new Map<string, number>();
  for (const e of entries) {
    if (e.dailyRate == null) continue;
    const hours = Number(e.hoursWorked);
    const rate = Number(e.dailyRate);
    if (!Number.isFinite(hours) || !Number.isFinite(rate)) continue;
    const currency = e.currency ?? '';
    totals.set(currency, (totals.get(currency) ?? 0) + (hours * rate) / HOURS_PER_DAY);
  }
  return Array.from(totals, ([currency, total]) => ({ currency, total }))
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/** "KES 2719", or "KES 2719 + USD 4563" for several currencies; a dash when there is no cost. */
export function formatLabourCost(totals: ReadonlyArray<LabourCostTotal>): string {
  const shown = totals.filter((t) => t.total > 0);
  if (shown.length === 0) return '—';
  return shown
    .map((t) => (t.currency ? `${t.currency} ${t.total.toFixed(0)}` : t.total.toFixed(0)))
    .join(' + ');
}
