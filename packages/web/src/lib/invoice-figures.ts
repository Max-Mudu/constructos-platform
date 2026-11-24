import type { InvoiceStatus } from '@/lib/types';

/**
 * Invoice money totals, the API's rule (packages/api/src/utils/invoice-balance.ts):
 *
 * "Outstanding" is the unpaid balance (total - paid) of the invoices the
 * company owes. Draft invoices (not yet submitted) and cancelled ones are not
 * owed; a paid invoice has no balance left. Amounts in different currencies
 * are never added together.
 */
export const OUTSTANDING_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'submitted',
  'approved',
  'partially_paid',
  'overdue',
  'disputed',
];

export function isOwedInvoiceStatus(status: InvoiceStatus): boolean {
  return OUTSTANDING_INVOICE_STATUSES.includes(status);
}

export interface InvoiceCurrencyTotals {
  currency:    string;
  totalValue:  number;
  totalPaid:   number;
  outstanding: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Totals per currency, sorted by currency code (the API's order). */
export function invoiceTotalsByCurrency(
  invoices: ReadonlyArray<{ status: InvoiceStatus; currency: string; totalAmount: string | number; paidAmount: string | number }>,
): InvoiceCurrencyTotals[] {
  const totals = new Map<string, InvoiceCurrencyTotals>();
  for (const inv of invoices) {
    const total = Number(inv.totalAmount);
    const paid  = Number(inv.paidAmount);
    if (!Number.isFinite(total) || !Number.isFinite(paid)) continue;
    const t = totals.get(inv.currency) ?? { currency: inv.currency, totalValue: 0, totalPaid: 0, outstanding: 0 };
    t.totalValue += total;
    t.totalPaid  += paid;
    if (isOwedInvoiceStatus(inv.status)) t.outstanding += total - paid;
    totals.set(inv.currency, t);
  }
  return Array.from(totals.values())
    .map((t) => ({ ...t, totalValue: cents(t.totalValue), totalPaid: cents(t.totalPaid), outstanding: cents(t.outstanding) }))
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/**
 * The dashboard's per-currency invoice totals. Older API builds send only the
 * single figures, which were labelled with the company currency; that
 * fallback is kept.
 */
export function dashboardInvoiceTotals(
  invoices: {
    totalValue: number; totalPaid: number; outstanding: number;
    byCurrency?: InvoiceCurrencyTotals[] | null;
  },
  companyCurrency: string,
): InvoiceCurrencyTotals[] {
  if (invoices.byCurrency && invoices.byCurrency.length > 0) return invoices.byCurrency;
  return [{
    currency:    companyCurrency,
    totalValue:  invoices.totalValue,
    totalPaid:   invoices.totalPaid,
    outstanding: invoices.outstanding,
  }];
}

/**
 * One formatted figure per currency joined with " + " ("KES 116K + $300");
 * a zero in the company currency when there is nothing to show.
 */
export function formatPerCurrency(
  totals: ReadonlyArray<InvoiceCurrencyTotals>,
  pick: (t: InvoiceCurrencyTotals) => number,
  format: (value: number, currency: string) => string,
  companyCurrency: string,
): string {
  if (totals.length === 0) return format(0, companyCurrency);
  return totals.map((t) => format(pick(t), t.currency)).join(' + ');
}
