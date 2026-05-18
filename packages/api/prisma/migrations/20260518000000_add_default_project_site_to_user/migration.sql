-- AlterTable
ALTER TABLE "users" ADD COLUMN "defaultProjectId" TEXT,
ADD COLUMN "defaultSiteId" TEXT;

-- CreateIndex
CREATE INDEX "users_defaultProjectId_idx" ON "users"("defaultProjectId");

-- CreateIndex
CREATE INDEX "users_defaultSiteId_idx" ON "users"("defaultSiteId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_defaultProjectId_fkey" FOREIGN KEY ("defaultProjectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_defaultSiteId_fkey" FOREIGN KEY ("defaultSiteId") REFERENCES "job_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
