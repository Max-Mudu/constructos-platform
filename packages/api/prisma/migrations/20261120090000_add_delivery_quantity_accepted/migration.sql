-- Accepted part of the delivered quantity for partially accepted deliveries.
-- Nullable, no default, no backfill: existing deliveries keep NULL
-- ("accepted quantity not recorded").

-- AlterTable
ALTER TABLE "delivery_records" ADD COLUMN "quantityAccepted" DECIMAL(12,3);
