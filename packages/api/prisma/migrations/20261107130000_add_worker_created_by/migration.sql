-- Records which user registered a worker. Nullable: rows created before this
-- migration keep NULL (no backfill).

-- AlterTable
ALTER TABLE "workers" ADD COLUMN "createdById" TEXT;

-- CreateIndex
CREATE INDEX "workers_companyId_createdById_idx" ON "workers"("companyId", "createdById");

-- AddForeignKey
ALTER TABLE "workers" ADD CONSTRAINT "workers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
