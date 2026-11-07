-- Additive only: two integer columns with a default of 0. Existing users and
-- refresh tokens start at version 0, so sessions issued before this migration
-- remain valid until the next session invalidation for that user.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
