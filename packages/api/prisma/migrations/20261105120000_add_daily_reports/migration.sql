-- CreateEnum
CREATE TYPE "DailyReportStatus" AS ENUM ('draft', 'final');

-- CreateEnum
CREATE TYPE "DailyReportExtractionStatus" AS ENUM ('not_requested', 'succeeded', 'failed');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "logoKey" TEXT;

-- CreateTable
CREATE TABLE "daily_reports" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "reportNumber" INTEGER NOT NULL,
    "status" "DailyReportStatus" NOT NULL DEFAULT 'draft',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "rawInput" TEXT NOT NULL DEFAULT '',
    "aiDraft" JSONB,
    "aiModel" TEXT,
    "aiPromptVersion" TEXT,
    "aiUsage" JSONB,
    "extractionStatus" "DailyReportExtractionStatus" NOT NULL DEFAULT 'not_requested',
    "extractionError" TEXT,
    "content" JSONB NOT NULL,
    "contentSchemaVersion" INTEGER NOT NULL DEFAULT 1,
    "preparedById" TEXT NOT NULL,
    "finalisedById" TEXT,
    "finalisedAt" TIMESTAMP(3),
    "pdfFileKey" TEXT,
    "contentHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_photos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dailyReportId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "caption" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_report_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_report_revisions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "dailyReportId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "contentSchemaVersion" INTEGER NOT NULL,
    "photos" JSONB NOT NULL,
    "pdfFileKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "finalisedById" TEXT NOT NULL,
    "finalisedAt" TIMESTAMP(3) NOT NULL,
    "reopenedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenReason" TEXT,

    CONSTRAINT "daily_report_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_reports_companyId_projectId_siteId_reportDate_idx" ON "daily_reports"("companyId", "projectId", "siteId", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_siteId_reportDate_key" ON "daily_reports"("siteId", "reportDate");

-- CreateIndex
CREATE UNIQUE INDEX "daily_reports_siteId_reportNumber_key" ON "daily_reports"("siteId", "reportNumber");

-- CreateIndex
CREATE UNIQUE INDEX "daily_report_photos_fileKey_key" ON "daily_report_photos"("fileKey");

-- CreateIndex
CREATE INDEX "daily_report_photos_dailyReportId_sortOrder_idx" ON "daily_report_photos"("dailyReportId", "sortOrder");

-- CreateIndex
CREATE INDEX "daily_report_photos_companyId_idx" ON "daily_report_photos"("companyId");

-- CreateIndex
CREATE INDEX "daily_report_revisions_companyId_idx" ON "daily_report_revisions"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_report_revisions_dailyReportId_revision_key" ON "daily_report_revisions"("dailyReportId", "revision");

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "job_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_reports" ADD CONSTRAINT "daily_reports_finalisedById_fkey" FOREIGN KEY ("finalisedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_photos" ADD CONSTRAINT "daily_report_photos_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_photos" ADD CONSTRAINT "daily_report_photos_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_revisions" ADD CONSTRAINT "daily_report_revisions_dailyReportId_fkey" FOREIGN KEY ("dailyReportId") REFERENCES "daily_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_revisions" ADD CONSTRAINT "daily_report_revisions_finalisedById_fkey" FOREIGN KEY ("finalisedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_report_revisions" ADD CONSTRAINT "daily_report_revisions_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

