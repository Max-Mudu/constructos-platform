-- Reconcile the migration history with prisma/schema.prisma.
--
-- Earlier schema changes were applied to local databases with `prisma db push`
-- and never captured in a migration, so a database built only with
-- `prisma migrate deploy` (production) was missing them. This migration adds
-- exactly the difference reported by
--   prisma migrate diff --from-migrations prisma/migrations \
--                       --to-schema-datamodel prisma/schema.prisma
--
-- Safety properties:
--   * Non-destructive: no table or column is dropped and no data is rewritten
--     lossily. The only type change (uuid -> text) is lossless.
--   * Idempotent: every statement is a no-op on a database that already matches
--     schema.prisma (e.g. one synced with `prisma db push`), so
--     `prisma migrate deploy` succeeds on fresh and on db-pushed databases.
--   * Foreign keys are only added when missing. If existing rows would violate
--     a new foreign key, the constraint is added NOT VALID (enforced for all new
--     and updated rows, existing rows left untouched) and a WARNING is raised,
--     instead of failing the deploy or deleting/nulling data. See the PR for
--     the clean-up + VALIDATE CONSTRAINT follow-up.

-- ─── Column defaults / nullability (metadata only, existing rows unchanged) ──

-- consultant_instructions: restore the defaults that were dropped when the
-- columns were converted to enums (20260409130000_add_instruction_enum_types).
ALTER TABLE "consultant_instructions"
  ALTER COLUMN "priority" SET DEFAULT 'medium',
  ALTER COLUMN "status"   SET DEFAULT 'open';

-- delivery_records.acceptanceStatus is optional in schema.prisma
-- (AcceptanceStatus?) and the service writes NULL when it is not supplied.
-- Relaxing NOT NULL keeps every existing value.
ALTER TABLE "delivery_records"
  ALTER COLUMN "acceptanceStatus" DROP NOT NULL,
  ALTER COLUMN "acceptanceStatus" DROP DEFAULT;

-- Prisma sets @updatedAt values itself; the DB-level defaults were temporary
-- back-fill helpers in earlier migrations. Existing values are unchanged.
ALTER TABLE "drawing_revisions" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- drawings.createdById was added with DEFAULT 'system' only to back-fill
-- existing rows; the application always supplies it.
ALTER TABLE "drawings" ALTER COLUMN "createdById" DROP DEFAULT;

ALTER TABLE "invoice_line_items"
  ALTER COLUMN "companyId" DROP DEFAULT,
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "notification_preferences" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- ─── inventory_transactions.scheduleTaskId: uuid -> text (lossless) ──────────
-- schema.prisma declares `String?` (TEXT). Only convert when the column is not
-- already text, so db-pushed databases are not rewritten.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'inventory_transactions'
      AND column_name = 'scheduleTaskId'
      AND data_type <> 'text'
  ) THEN
    ALTER TABLE "inventory_transactions"
      ALTER COLUMN "scheduleTaskId" SET DATA TYPE TEXT USING "scheduleTaskId"::TEXT;
  END IF;
END $$;

-- ─── workers.userId (links a worker profile to its platform user) ───────────
ALTER TABLE "workers" ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "workers_userId_key" ON "workers"("userId");

-- ─── push_tokens ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "push_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_tokens_token_key" ON "push_tokens"("token");

-- ─── Foreign keys (added only if missing; NOT VALID if existing rows violate) ─

-- workers.userId -> users.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workers_userId_fkey'
      AND conrelid = to_regclass('"workers"')
  ) THEN
    IF EXISTS (
      SELECT 1 FROM "workers" w
      WHERE w."userId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = w."userId")
    ) THEN
      RAISE WARNING 'workers.userId has values with no matching user; adding workers_userId_fkey NOT VALID';
      ALTER TABLE "workers" ADD CONSTRAINT "workers_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
    ELSE
      ALTER TABLE "workers" ADD CONSTRAINT "workers_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

-- invoices.approvedById -> users.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'invoices_approvedById_fkey'
      AND conrelid = to_regclass('"invoices"')
  ) THEN
    IF EXISTS (
      SELECT 1 FROM "invoices" i
      WHERE i."approvedById" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = i."approvedById")
    ) THEN
      RAISE WARNING 'invoices.approvedById has values with no matching user; adding invoices_approvedById_fkey NOT VALID';
      ALTER TABLE "invoices" ADD CONSTRAINT "invoices_approvedById_fkey"
        FOREIGN KEY ("approvedById") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
    ELSE
      ALTER TABLE "invoices" ADD CONSTRAINT "invoices_approvedById_fkey"
        FOREIGN KEY ("approvedById") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

-- push_tokens.userId -> users.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'push_tokens_userId_fkey'
      AND conrelid = to_regclass('"push_tokens"')
  ) THEN
    IF EXISTS (
      SELECT 1 FROM "push_tokens" p
      WHERE NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = p."userId")
    ) THEN
      RAISE WARNING 'push_tokens.userId has values with no matching user; adding push_tokens_userId_fkey NOT VALID';
      ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
    ELSE
      ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;

-- push_tokens.companyId -> companies.id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'push_tokens_companyId_fkey'
      AND conrelid = to_regclass('"push_tokens"')
  ) THEN
    IF EXISTS (
      SELECT 1 FROM "push_tokens" p
      WHERE NOT EXISTS (SELECT 1 FROM "companies" c WHERE c."id" = p."companyId")
    ) THEN
      RAISE WARNING 'push_tokens.companyId has values with no matching company; adding push_tokens_companyId_fkey NOT VALID';
      ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "companies"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
    ELSE
      ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_companyId_fkey"
        FOREIGN KEY ("companyId") REFERENCES "companies"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
  END IF;
END $$;
