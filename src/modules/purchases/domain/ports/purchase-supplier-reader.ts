import type { UUID } from '@shared/types/index.js';

/**
 * Output port the Purchases module uses to verify a supplier exists before
 * opening a purchase (Requirement 9.1, 10.3).
 *
 * Declared in the Purchases module and implemented in infrastructure against
 * the Suppliers/Prisma layer, so Purchases validates the `supplierId` foreign
 * key without importing the Suppliers module internals (Dependency Inversion,
 * Clean Architecture Requirement 3.2).
 */
export interface IPurchaseSupplierReader {
  /** Returns `true` when a non-deleted supplier with `supplierId` exists for the tenant. */
  exists(tenantId: UUID, supplierId: UUID): Promise<boolean>;
}
