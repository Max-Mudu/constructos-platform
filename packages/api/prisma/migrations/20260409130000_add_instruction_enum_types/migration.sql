-- Patch: add missing PostgreSQL enum types for consultant_instructions
-- The previous migration created these columns as TEXT; Prisma requires native enum types.

CREATE TYPE "InstructionType" AS ENUM ('instruction', 'recommendation');
CREATE TYPE "InstructionPriority" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "InstructionStatus" AS ENUM ('open', 'acknowledged', 'in_progress', 'resolved', 'rejected');

-- Drop defaults before altering column types (PostgreSQL cannot cast defaults automatically)
ALTER TABLE "consultant_instructions" ALTER COLUMN "type"     DROP DEFAULT;
ALTER TABLE "consultant_instructions" ALTER COLUMN "priority" DROP DEFAULT;
ALTER TABLE "consultant_instructions" ALTER COLUMN "status"   DROP DEFAULT;

ALTER TABLE "consultant_instructions"
  ALTER COLUMN "type"     TYPE "InstructionType"     USING "type"::"InstructionType",
  ALTER COLUMN "priority" TYPE "InstructionPriority" USING "priority"::"InstructionPriority",
  ALTER COLUMN "status"   TYPE "InstructionStatus"   USING "status"::"InstructionStatus";
