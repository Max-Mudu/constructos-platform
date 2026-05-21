-- Fix: rename snake_case columns added in 20260517100000 to camelCase,
-- consistent with every other column in inventory_transactions.

ALTER TABLE "inventory_transactions"
  RENAME COLUMN "usage_reason"     TO "usageReason";

ALTER TABLE "inventory_transactions"
  RENAME COLUMN "work_area"        TO "workArea";

ALTER TABLE "inventory_transactions"
  RENAME COLUMN "schedule_task_id" TO "scheduleTaskId";
