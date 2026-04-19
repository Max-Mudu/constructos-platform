-- Day 6: Attendance & Daily Targets
-- 1. Update AttendanceStatus enum (present, absent, late, half_day, excused)
-- 2. Add workerId, approvedById, approvedAt to daily_targets

-- ── Step 1: Update AttendanceStatus enum ─────────────────────────────────────

-- Rename old enum
ALTER TYPE "AttendanceStatus" RENAME TO "AttendanceStatus_old";

-- Create new enum with correct values
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'late', 'half_day', 'excused');

-- Alter column: map old-only values (sick → excused, leave → excused)
ALTER TABLE "attendance_records"
  ALTER COLUMN "status" TYPE "AttendanceStatus"
  USING (
    CASE "status"::text
      WHEN 'sick'  THEN 'excused'
      WHEN 'leave' THEN 'excused'
      ELSE "status"::text
    END
  )::"AttendanceStatus";

-- Drop old enum
DROP TYPE "AttendanceStatus_old";

-- ── Step 2: Add columns to daily_targets ─────────────────────────────────────

ALTER TABLE "daily_targets" ADD COLUMN "workerId"     TEXT;
ALTER TABLE "daily_targets" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "daily_targets" ADD COLUMN "approvedAt"   TIMESTAMP(3);

-- Foreign key: workerId → workers(id)
ALTER TABLE "daily_targets"
  ADD CONSTRAINT "daily_targets_workerId_fkey"
  FOREIGN KEY ("workerId") REFERENCES "workers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Foreign key: approvedById → users(id)
ALTER TABLE "daily_targets"
  ADD CONSTRAINT "daily_targets_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
