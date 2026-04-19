-- AlterTable drawings: add siteId and createdById
ALTER TABLE "drawings" ADD COLUMN "siteId" TEXT;
ALTER TABLE "drawings" ADD COLUMN "createdById" TEXT NOT NULL DEFAULT 'system';

-- AlterTable drawing_revisions: add issueDate, approvedById, approvedAt, updatedAt
ALTER TABLE "drawing_revisions" ADD COLUMN "issueDate" DATE;
ALTER TABLE "drawing_revisions" ADD COLUMN "approvedById" TEXT;
ALTER TABLE "drawing_revisions" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "drawing_revisions" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable drawing_comments
CREATE TABLE "drawing_comments" (
    "id"         TEXT NOT NULL,
    "companyId"  TEXT NOT NULL,
    "drawingId"  TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "text"       TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drawing_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable consultant_instructions
CREATE TABLE "consultant_instructions" (
    "id"                 TEXT NOT NULL,
    "companyId"          TEXT NOT NULL,
    "projectId"          TEXT NOT NULL,
    "siteId"             TEXT,
    "contractorId"       TEXT,
    "issuedById"         TEXT NOT NULL,
    "type"               TEXT NOT NULL,
    "title"              TEXT NOT NULL,
    "category"           TEXT,
    "priority"           TEXT NOT NULL DEFAULT 'medium',
    "status"             TEXT NOT NULL DEFAULT 'open',
    "description"        TEXT,
    "issuedDate"         DATE NOT NULL,
    "targetActionDate"   DATE,
    "drawingId"          TEXT,
    "revisionId"         TEXT,
    "milestoneId"        TEXT,
    "workPackageId"      TEXT,
    "contractorResponse" TEXT,
    "resolutionNotes"    TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultant_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable instruction_attachments
CREATE TABLE "instruction_attachments" (
    "id"            TEXT NOT NULL,
    "instructionId" TEXT NOT NULL,
    "companyId"     TEXT NOT NULL,
    "fileUrl"       TEXT NOT NULL,
    "fileKey"       TEXT NOT NULL,
    "fileName"      TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileType"      TEXT NOT NULL,
    "uploadedById"  TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instruction_attachments_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey drawings → job_sites
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "job_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey drawings → users (createdBy)
ALTER TABLE "drawings" ADD CONSTRAINT "drawings_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey drawing_revisions → users (approvedBy)
ALTER TABLE "drawing_revisions" ADD CONSTRAINT "drawing_revisions_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey drawing_comments → drawings
ALTER TABLE "drawing_comments" ADD CONSTRAINT "drawing_comments_drawingId_fkey"
  FOREIGN KEY ("drawingId") REFERENCES "drawings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey drawing_comments → drawing_revisions
ALTER TABLE "drawing_comments" ADD CONSTRAINT "drawing_comments_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "drawing_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey drawing_comments → users
ALTER TABLE "drawing_comments" ADD CONSTRAINT "drawing_comments_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey consultant_instructions → projects
ALTER TABLE "consultant_instructions" ADD CONSTRAINT "consultant_instructions_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey consultant_instructions → job_sites
ALTER TABLE "consultant_instructions" ADD CONSTRAINT "consultant_instructions_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "job_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey consultant_instructions → contractors
ALTER TABLE "consultant_instructions" ADD CONSTRAINT "consultant_instructions_contractorId_fkey"
  FOREIGN KEY ("contractorId") REFERENCES "contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey consultant_instructions → users (issuedBy)
ALTER TABLE "consultant_instructions" ADD CONSTRAINT "consultant_instructions_issuedById_fkey"
  FOREIGN KEY ("issuedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey consultant_instructions → drawings
ALTER TABLE "consultant_instructions" ADD CONSTRAINT "consultant_instructions_drawingId_fkey"
  FOREIGN KEY ("drawingId") REFERENCES "drawings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey consultant_instructions → drawing_revisions
ALTER TABLE "consultant_instructions" ADD CONSTRAINT "consultant_instructions_revisionId_fkey"
  FOREIGN KEY ("revisionId") REFERENCES "drawing_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey consultant_instructions → schedule_milestones
ALTER TABLE "consultant_instructions" ADD CONSTRAINT "consultant_instructions_milestoneId_fkey"
  FOREIGN KEY ("milestoneId") REFERENCES "schedule_milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey consultant_instructions → work_packages
ALTER TABLE "consultant_instructions" ADD CONSTRAINT "consultant_instructions_workPackageId_fkey"
  FOREIGN KEY ("workPackageId") REFERENCES "work_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey instruction_attachments → consultant_instructions
ALTER TABLE "instruction_attachments" ADD CONSTRAINT "instruction_attachments_instructionId_fkey"
  FOREIGN KEY ("instructionId") REFERENCES "consultant_instructions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
