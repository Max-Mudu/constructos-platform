import { Prisma } from '@prisma/client';

/**
 * Labour cost: the one rule used by the dashboard and the labour report (the
 * web Labour Register applies the same rule in packages/web/src/lib/workflows-labour.ts).
 *
 * Every labour rate in the model is a DAILY rate: LabourEntry.dailyRate is
 * copied from Worker.dailyWage (or set by a finance user) and there is no
 * hourly rate or rate-type column. The cost of one entry is therefore
 *
 *   hoursWorked / 8 x dailyRate
 *
 * pro rata both below and above a day (10 h = 1.25 days; hours are capped at
 * 24 by the route schema, not here). Nothing is stored: the cost is computed
 * when read, from the stored hours and rate.
 *
 * Exact decimal arithmetic (no float drift); callers round only for display.
 * Amounts in different currencies are never added together.
 */
export const HOURS_PER_DAY = 8;

type DecimalInput = Prisma.Decimal | number | string;

export function labourEntryCost(hoursWorked: DecimalInput, dailyRate: DecimalInput): Prisma.Decimal {
  return new Prisma.Decimal(hoursWorked).div(HOURS_PER_DAY).mul(dailyRate);
}

export interface LabourCostTotal {
  currency: string;
  total:    Prisma.Decimal;
}

/** Total cost per currency, sorted by currency code (stable for every consumer). */
export function labourCostByCurrency(
  entries: ReadonlyArray<{ hoursWorked: DecimalInput; dailyRate: DecimalInput; currency: string }>,
): LabourCostTotal[] {
  const totals = new Map<string, Prisma.Decimal>();
  for (const e of entries) {
    const prev = totals.get(e.currency) ?? new Prisma.Decimal(0);
    totals.set(e.currency, prev.add(labourEntryCost(e.hoursWorked, e.dailyRate)));
  }
  return Array.from(totals, ([currency, total]) => ({ currency, total }))
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/** A money amount rounded to cents (half up), as a number for JSON. */
export function toCents(amount: Prisma.Decimal): number {
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();
}
