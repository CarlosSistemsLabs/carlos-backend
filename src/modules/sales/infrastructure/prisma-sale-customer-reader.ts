import type { UUID } from '@shared/types/index.js';
import type { ISaleCustomerReader } from '../domain/ports/sale-customer-reader.js';

/** Minimal `customer` delegate surface used by {@link PrismaSaleCustomerReader}. */
export interface CustomerExistsDelegate {
  count(args: { where?: Record<string, unknown> }): Promise<number>;
}

/** A Prisma-like client exposing (at least) the `customer` delegate. */
export interface SaleCustomerReaderPrismaClient {
  customer: CustomerExistsDelegate;
}

/**
 * Prisma-backed {@link ISaleCustomerReader}.
 *
 * Implements the Sales-owned customer existence port against the shared
 * `Customer` table (Dependency Inversion — Sales does not import the Customers
 * module internals). Excludes soft-deleted customers and scopes by `tenantId`
 * for defence-in-depth (Requirement 1.5).
 */
export class PrismaSaleCustomerReader implements ISaleCustomerReader {
  constructor(private readonly prisma: SaleCustomerReaderPrismaClient) {}

  async exists(tenantId: UUID, customerId: UUID): Promise<boolean> {
    const count = await this.prisma.customer.count({
      where: { id: customerId, tenantId, deletedAt: null },
    });
    return count > 0;
  }
}
