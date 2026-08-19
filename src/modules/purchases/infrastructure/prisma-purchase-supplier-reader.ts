import type { UUID } from '@shared/types/index.js';
import type { IPurchaseSupplierReader } from '../domain/ports/purchase-supplier-reader.js';

/** Minimal `supplier` delegate surface used by {@link PrismaPurchaseSupplierReader}. */
export interface SupplierExistsDelegate {
  count(args: { where?: Record<string, unknown> }): Promise<number>;
}

/** A Prisma-like client exposing (at least) the `supplier` delegate. */
export interface PurchaseSupplierReaderPrismaClient {
  supplier: SupplierExistsDelegate;
}

/**
 * Prisma-backed {@link IPurchaseSupplierReader}.
 *
 * Implements the Purchases-owned supplier existence port against the shared
 * `Supplier` table (Dependency Inversion — Purchases does not import the
 * Suppliers module internals). Excludes soft-deleted suppliers and scopes by
 * `tenantId` for defence-in-depth (Requirement 1.5).
 */
export class PrismaPurchaseSupplierReader implements IPurchaseSupplierReader {
  constructor(private readonly prisma: PurchaseSupplierReaderPrismaClient) {}

  async exists(tenantId: UUID, supplierId: UUID): Promise<boolean> {
    const count = await this.prisma.supplier.count({
      where: { id: supplierId, tenantId, deletedAt: null },
    });
    return count > 0;
  }
}
