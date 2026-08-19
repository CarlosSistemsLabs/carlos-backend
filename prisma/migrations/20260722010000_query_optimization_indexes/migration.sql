-- Query optimization (task 39.3): composite indexes on tenant-scoped, high-
-- traffic lookup/filter/sort columns not already covered by an existing index.
-- These optimize the hottest list/detail read paths (Req 26.4, 26.5) and back
-- cursor-based pagination on the largest datasets (Req 26.6). Additive only —
-- no table drops/recreations and no data changes.
--
-- NOTE: generated but NOT applied in this environment (no PostgreSQL/Docker
-- available). Apply with `prisma migrate deploy` once a database is provisioned.

-- Product catalogue list scopes by tenantId and orders by name; the frequent
-- active/inactive filter is tenant-scoped too.
-- CreateIndex
CREATE INDEX "Product_tenantId_name_idx" ON "Product"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Product_tenantId_isActive_idx" ON "Product"("tenantId", "isActive");

-- Stock-movement audit list scopes by tenantId and orders by createdAt desc
-- (the primary target for cursor pagination); per-product history adds productId.
-- CreateIndex
CREATE INDEX "StockMovement_tenantId_createdAt_idx" ON "StockMovement"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_productId_createdAt_idx" ON "StockMovement"("tenantId", "productId", "createdAt");

-- Sales list scopes by tenantId and orders by saleDate desc without a status
-- filter — more selective than the single-column [saleDate] index.
-- CreateIndex
CREATE INDEX "Sale_tenantId_saleDate_idx" ON "Sale"("tenantId", "saleDate");

-- Purchase list mirrors Sale: tenant-scoped date ordering plus a status-filtered
-- variant.
-- CreateIndex
CREATE INDEX "Purchase_tenantId_purchaseDate_idx" ON "Purchase"("tenantId", "purchaseDate");

-- CreateIndex
CREATE INDEX "Purchase_tenantId_status_purchaseDate_idx" ON "Purchase"("tenantId", "status", "purchaseDate");

-- Customer list scopes by tenantId and orders by name; tenant-scoped email
-- lookup is more selective than the bare [email] index.
-- CreateIndex
CREATE INDEX "Customer_tenantId_name_idx" ON "Customer"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Customer_tenantId_email_idx" ON "Customer"("tenantId", "email");

-- Supplier list scopes by tenantId and orders by name.
-- CreateIndex
CREATE INDEX "Supplier_tenantId_name_idx" ON "Supplier"("tenantId", "name");
