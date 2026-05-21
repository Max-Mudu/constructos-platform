-- Idempotent fix for inventory_transactions column naming.
--
-- The previous migration (20260517100000_inventory_usage_fields) added
-- usage_reason / work_area / schedule_task_id (snake_case), but every other
-- column in this table is camelCase.  Prisma expects camelCase column names
-- when no @map annotation is present.
--
-- Handles all four DB states for each column:
--   A  snake_case only      → rename to camelCase
--   B  camelCase only       → nothing to do
--   C  both                 → copy snake→camelCase where null, drop snake
--   D  neither              → add camelCase column

-- ── usageReason ──────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'usage_reason'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'usageReason'
  ) THEN
    -- A: only snake_case → rename
    ALTER TABLE "inventory_transactions" RENAME COLUMN "usage_reason" TO "usageReason";

  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'usage_reason'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'usageReason'
  ) THEN
    -- C: both exist → merge then drop snake_case
    UPDATE "inventory_transactions"
      SET "usageReason" = "usage_reason"
      WHERE "usageReason" IS NULL AND "usage_reason" IS NOT NULL;
    ALTER TABLE "inventory_transactions" DROP COLUMN "usage_reason";

  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'usage_reason'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'usageReason'
  ) THEN
    -- D: neither exists → add camelCase
    ALTER TABLE "inventory_transactions" ADD COLUMN "usageReason" TEXT;

  -- B: only camelCase exists → do nothing
  END IF;
END $$;

-- ── workArea ─────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'work_area'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'workArea'
  ) THEN
    ALTER TABLE "inventory_transactions" RENAME COLUMN "work_area" TO "workArea";

  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'work_area'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'workArea'
  ) THEN
    UPDATE "inventory_transactions"
      SET "workArea" = "work_area"
      WHERE "workArea" IS NULL AND "work_area" IS NOT NULL;
    ALTER TABLE "inventory_transactions" DROP COLUMN "work_area";

  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'work_area'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'workArea'
  ) THEN
    ALTER TABLE "inventory_transactions" ADD COLUMN "workArea" TEXT;

  END IF;
END $$;

-- ── scheduleTaskId ───────────────────────────────────────────────────────────
-- Prisma schema: scheduleTaskId String? (TEXT) — no @db.Uuid annotation.
-- The original migration created this as UUID; TEXT is compatible for
-- reading/writing UUID-formatted values and matches Prisma's expectation.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'schedule_task_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'scheduleTaskId'
  ) THEN
    ALTER TABLE "inventory_transactions" RENAME COLUMN "schedule_task_id" TO "scheduleTaskId";

  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'schedule_task_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'scheduleTaskId'
  ) THEN
    UPDATE "inventory_transactions"
      SET "scheduleTaskId" = "schedule_task_id"::TEXT
      WHERE "scheduleTaskId" IS NULL AND "schedule_task_id" IS NOT NULL;
    ALTER TABLE "inventory_transactions" DROP COLUMN "schedule_task_id";

  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'schedule_task_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_transactions' AND column_name = 'scheduleTaskId'
  ) THEN
    ALTER TABLE "inventory_transactions" ADD COLUMN "scheduleTaskId" TEXT;

  END IF;
END $$;
