-- Day 9: Add currency, notes, createdById, approvedBy relation to budgets table

ALTER TABLE "budgets"
  ADD COLUMN "currency"    TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN "notes"       TEXT,
  ADD COLUMN "createdById" TEXT;

ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "budgets"
  ADD CONSTRAINT "budgets_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
