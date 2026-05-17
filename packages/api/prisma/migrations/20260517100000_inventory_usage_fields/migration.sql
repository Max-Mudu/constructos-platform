-- Migration: 20260517100000_inventory_usage_fields
-- Adds usage_reason, work_area, schedule_task_id to inventory_transactions.
-- schedule_task_id is stored as a plain UUID string (no FK constraint) to keep this lightweight.

ALTER TABLE "inventory_transactions"
  ADD COLUMN "usage_reason"     TEXT,
  ADD COLUMN "work_area"        TEXT,
  ADD COLUMN "schedule_task_id" UUID;
