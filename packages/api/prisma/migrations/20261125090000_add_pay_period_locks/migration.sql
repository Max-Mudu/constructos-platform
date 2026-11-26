-- Pay-period lock history. Additive only: one new enum and one new table.
-- No existing table, column or row is changed.

-- CreateEnum
CREATE TYPE "PayPeriodLockAction" AS ENUM ('close', 'reopen');

-- CreateTable
CREATE TABLE "pay_period_locks" (
    "id" SERIAL NOT NULL,
    "companyId" TEXT NOT NULL,
    "action" "PayPeriodLockAction" NOT NULL,
    "lockedThrough" DATE,
    "previousLockedThrough" DATE,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_period_locks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pay_period_locks_companyId_id_idx" ON "pay_period_locks"("companyId", "id");

-- AddForeignKey
ALTER TABLE "pay_period_locks" ADD CONSTRAINT "pay_period_locks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_period_locks" ADD CONSTRAINT "pay_period_locks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
