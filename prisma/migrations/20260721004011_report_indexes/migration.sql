-- Report query optimization (task 25.2): composite indexes aligned with the
-- Reports module reader queries (see src/modules/reports/infrastructure).
-- These add index tenant_id + frequently queried fields (Req 26.4) and improve
-- selectivity for reporting aggregations (Req 31.4). Additive only — no table
-- drops/recreations and no data changes.

-- Sales summary, top-customers and product-performance readers scope Sale by
-- tenantId + status='completed' over a saleDate range (sales summary also
-- orders by saleDate). Leading equality columns (tenantId, status) + range/sort
-- column (saleDate) give the optimal B-tree layout.
-- CreateIndex
CREATE INDEX "Sale_tenantId_status_saleDate_idx" ON "Sale"("tenantId", "status", "saleDate");

-- Cash-flow reader groups movements by (type, category) scoped by tenantId over
-- a date range.
-- CreateIndex
CREATE INDEX "CashMovement_tenantId_date_idx" ON "CashMovement"("tenantId", "date");

-- Cash-flow reader with an optional single-cash-box filter (cashId) benefits
-- from a [cashId, date] composite that also narrows the date window.
-- CreateIndex
CREATE INDEX "CashMovement_cashId_date_idx" ON "CashMovement"("cashId", "date");
