-- Day 10: Invoicing and Payments MVP
-- Expand Invoice model, add InvoicePayment, update enums

-- ── Add new enum values ──────────────────────────────────────────────────────
ALTER TYPE "InvoiceStatus" ADD VALUE 'partially_paid';
ALTER TYPE "InvoiceStatus" ADD VALUE 'overdue';
ALTER TYPE "InvoiceVendorType" ADD VALUE 'marketing';
ALTER TYPE "InvoiceVendorType" ADD VALUE 'internal';

-- ── Add new columns to invoices ───────────────────────────────────────────────
ALTER TABLE "invoices"
  ADD COLUMN "siteId"                TEXT,
  ADD COLUMN "supplierId"            TEXT,
  ADD COLUMN "consultantUserId"      TEXT,
  ADD COLUMN "variationOrderId"      TEXT,
  ADD COLUMN "deliveryRecordId"      TEXT,
  ADD COLUMN "labourEntryId"         TEXT,
  ADD COLUMN "marketingBudgetEntryId" TEXT,
  ADD COLUMN "consultantCostEntryId"  TEXT,
  ADD COLUMN "createdById"           TEXT;

-- Add companyId to invoice_line_items and notes/updatedAt
ALTER TABLE "invoice_line_items"
  ADD COLUMN "companyId"  TEXT NOT NULL DEFAULT '',
  ADD COLUMN "notes"      TEXT,
  ADD COLUMN "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── FK constraints for new invoice columns ───────────────────────────────────
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "job_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_consultantUserId_fkey"
    FOREIGN KEY ("consultantUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_variationOrderId_fkey"
    FOREIGN KEY ("variationOrderId") REFERENCES "variation_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_deliveryRecordId_fkey"
    FOREIGN KEY ("deliveryRecordId") REFERENCES "delivery_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_labourEntryId_fkey"
    FOREIGN KEY ("labourEntryId") REFERENCES "labour_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_marketingBudgetEntryId_fkey"
    FOREIGN KEY ("marketingBudgetEntryId") REFERENCES "marketing_budget_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_consultantCostEntryId_fkey"
    FOREIGN KEY ("consultantCostEntryId") REFERENCES "consultant_cost_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Create invoice_payments table ────────────────────────────────────────────
CREATE TABLE "invoice_payments" (
  "id"           TEXT NOT NULL,
  "invoiceId"    TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "amount"       DECIMAL(15, 2) NOT NULL,
  "currency"     TEXT NOT NULL DEFAULT 'USD',
  "paymentDate"  DATE NOT NULL,
  "method"       TEXT NOT NULL,
  "reference"    TEXT,
  "notes"        TEXT,
  "recordedById" TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_payments_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "invoice_payments_recordedById_fkey"
    FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
