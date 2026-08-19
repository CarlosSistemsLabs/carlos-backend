import type { UUID } from '@shared/types/index.js';

/**
 * Output port the Sales module uses to verify a customer exists before opening
 * a sale (Requirement 9.1).
 *
 * Declared in the Sales module and implemented in infrastructure against the
 * Customers/Prisma layer, so Sales validates the `customerId` foreign key
 * without importing the Customers module internals (Dependency Inversion, Clean
 * Architecture Requirement 3.2).
 */
export interface ISaleCustomerReader {
  /** Returns `true` when a non-deleted customer with `customerId` exists for the tenant. */
  exists(tenantId: UUID, customerId: UUID): Promise<boolean>;
}
