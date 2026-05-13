-- CreateEnum
CREATE TYPE "InventoryTxType" AS ENUM ('delivery_in', 'usage_out', 'adjustment_in', 'adjustment_out', 'transfer_in', 'transfer_out');

-- CreateTable
CREATE TABLE "site_inventory" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "materialName" TEXT NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "currentQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "lowStockThreshold" DECIMAL(12,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "deliveryId" TEXT,
    "type" "InventoryTxType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitOfMeasure" TEXT NOT NULL,
    "note" TEXT,
    "performedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_inventory_companyId_idx" ON "site_inventory"("companyId");

-- CreateIndex
CREATE INDEX "site_inventory_siteId_idx" ON "site_inventory"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "site_inventory_siteId_materialName_unitOfMeasure_key" ON "site_inventory"("siteId", "materialName", "unitOfMeasure");

-- CreateIndex
CREATE INDEX "inventory_transactions_inventoryId_idx" ON "inventory_transactions"("inventoryId");

-- CreateIndex
CREATE INDEX "inventory_transactions_siteId_idx" ON "inventory_transactions"("siteId");

-- CreateIndex
CREATE INDEX "inventory_transactions_companyId_idx" ON "inventory_transactions"("companyId");

-- CreateIndex
CREATE INDEX "inventory_transactions_deliveryId_idx" ON "inventory_transactions"("deliveryId");

-- AddForeignKey
ALTER TABLE "site_inventory" ADD CONSTRAINT "site_inventory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_inventory" ADD CONSTRAINT "site_inventory_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "job_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "job_sites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "site_inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "delivery_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

