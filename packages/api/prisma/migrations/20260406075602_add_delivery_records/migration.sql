-- CreateEnum
CREATE TYPE "DeliveryCondition" AS ENUM ('good', 'damaged', 'partial', 'incorrect');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('pending', 'passed', 'failed', 'waived');

-- CreateEnum
CREATE TYPE "AcceptanceStatus" AS ENUM ('accepted', 'partially_accepted', 'rejected');

-- CreateTable
CREATE TABLE "delivery_records" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "supplierContact" TEXT,
    "deliveryDate" DATE NOT NULL,
    "deliveryTime" TEXT,
    "driverName" TEXT,
    "vehicleRegistration" TEXT,
    "purchaseOrderNumber" TEXT,
    "deliveryNoteNumber" TEXT,
    "invoiceNumber" TEXT,
    "itemDescription" TEXT NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "quantityOrdered" DECIMAL(12,3) NOT NULL,
    "quantityDelivered" DECIMAL(12,3) NOT NULL,
    "conditionOnArrival" "DeliveryCondition" NOT NULL DEFAULT 'good',
    "inspectionStatus" "InspectionStatus" NOT NULL DEFAULT 'pending',
    "acceptanceStatus" "AcceptanceStatus" NOT NULL DEFAULT 'accepted',
    "rejectionReason" TEXT,
    "discrepancyNotes" TEXT,
    "receivedById" TEXT NOT NULL,
    "budgetLineItemId" TEXT,
    "supplierInvoiceId" TEXT,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_photos" (
    "id" TEXT NOT NULL,
    "deliveryRecordId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_documents" (
    "id" TEXT NOT NULL,
    "deliveryRecordId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "fileType" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_documents_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "job_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_budgetLineItemId_fkey" FOREIGN KEY ("budgetLineItemId") REFERENCES "budget_line_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_records" ADD CONSTRAINT "delivery_records_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_photos" ADD CONSTRAINT "delivery_photos_deliveryRecordId_fkey" FOREIGN KEY ("deliveryRecordId") REFERENCES "delivery_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_documents" ADD CONSTRAINT "delivery_documents_deliveryRecordId_fkey" FOREIGN KEY ("deliveryRecordId") REFERENCES "delivery_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
