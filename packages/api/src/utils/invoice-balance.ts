import { InvoiceStatus, Prisma } from '@prisma/client';

/**
 * Invoice money totals: the one rule used by the dashboard, GET
 * /invoices/summary and the invoice report (the web Invoices page applies the
 * same rule in packages/web/src/lib/invoice-figures.ts).
 *
 * "Outstanding" is the unpaid balance (totalAmount - paidAmount) of the
 * invoices the company owes; "In dispute" is the unpaid balance of disputed
 * invoices, shown separately. Taken from the invoice lifecycle in
 * invoice.service.ts:
 *   - draft:      not yet submitted; can still be edited or deleted. Not owed.
 *   - cancelled:  withdrawn; no payment can be recorded. Not owed.
 *   - paid:       settled; its balance is zero.
 *   - submitted:  received and awaiting approval; the overdue sweep moves it
 *                 to overdue after its due date, so it is a claim with a due
 *                 date. Owed.
 *   - approved, partially_paid, overdue: the states a payment can be recorded
 *                 against. Owed.
 *   - disputed:   not in Outstanding; its balance is reported separately as
 *                 "In dispute" (no payment can be recorded against it).
 *
 * Amounts in different currencies are never added together: every total is
 * per currency, sorted by currency code.
 */
export const OUTSTANDING_INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'submitted',
  'approved',
  'partially_paid',
  'overdue',
];

export function isOwedInvoiceStatus(status: InvoiceStatus): boolean {
  return OUTSTANDING_INVOICE_STATUSES.includes(status);
}

type DecimalInput = Prisma.Decimal | number | string;

export interface InvoiceAmountRow {
  status:      InvoiceStatus;
  currency:    string;
  totalAmount: DecimalInput;
  paidAmount:  DecimalInput;
}

export interface InvoiceCurrencyTotals {
  currency:    string;
  /** Sum of totalAmount over every invoice in the currency (all statuses). */
  totalValue:  Prisma.Decimal;
  /** Sum of paidAmount over every invoice in the currency (all statuses). */
  totalPaid:   Prisma.Decimal;
  /** Unpaid balance of the owed invoices (OUTSTANDING_INVOICE_STATUSES). */
  outstanding: Prisma.Decimal;
  /** Unpaid balance of the disputed invoices (not part of outstanding). */
  inDispute:   Prisma.Decimal;
  /** Unpaid balance of the overdue invoices. */
  overdueValue: Prisma.Decimal;
}

const ZERO = new Prisma.Decimal(0);

/** Totals per currency, sorted by currency code (stable for every consumer). */
export function invoiceTotalsByCurrency(rows: ReadonlyArray<InvoiceAmountRow>): InvoiceCurrencyTotals[] {
  const totals = new Map<string, InvoiceCurrencyTotals>();
  for (const row of rows) {
    const t = totals.get(row.currency) ?? {
      currency: row.currency, totalValue: ZERO, totalPaid: ZERO, outstanding: ZERO, inDispute: ZERO, overdueValue: ZERO,
    };
    const total   = new Prisma.Decimal(row.totalAmount);
    const paid    = new Prisma.Decimal(row.paidAmount);
    const balance = total.sub(paid);
    t.totalValue = t.totalValue.add(total);
    t.totalPaid  = t.totalPaid.add(paid);
    if (isOwedInvoiceStatus(row.status)) t.outstanding  = t.outstanding.add(balance);
    if (row.status === 'disputed')       t.inDispute    = t.inDispute.add(balance);
    if (row.status === 'overdue')        t.overdueValue = t.overdueValue.add(balance);
    totals.set(row.currency, t);
  }
  return Array.from(totals.values())
    .sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/** The totals for one currency, or zeros when there are none in it. */
export function totalsForCurrency(totals: ReadonlyArray<InvoiceCurrencyTotals>, currency: string): InvoiceCurrencyTotals {
  return totals.find((t) => t.currency === currency)
    ?? { currency, totalValue: ZERO, totalPaid: ZERO, outstanding: ZERO, inDispute: ZERO, overdueValue: ZERO };
}
