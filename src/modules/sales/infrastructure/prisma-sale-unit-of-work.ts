import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type {
  ISaleUnitOfWork,
  SaleTransactionContext,
} from '../domain/repositories/sale-unit-of-work.js';
import { PrismaSaleRepository, type SalePrismaClient } from './prisma-sale-repository.js';

/** A transaction client exposing the delegates the sale repository needs. */
export type SaleTransactionClient = SalePrismaClient;

/**
 * A Prisma-like client capable of running an interactive transaction. Kept
 * structural so the unit-of-work can be exercised with a fake in tests without
 * importing the full `PrismaClient` type.
 */
export interface TransactionalPrismaClient {
  $transaction<T>(fn: (tx: SaleTransactionClient) => Promise<T>): Promise<T>;
}

/**
 * Prisma-backed {@link ISaleUnitOfWork}.
 *
 * Wraps the callback in a Prisma `$transaction` and constructs a
 * transaction-scoped {@link PrismaSaleRepository} over the transaction client
 * `tx`, so allocating the sale number and inserting the sale header + lines
 * commit or roll back atomically. Bound to the tenant-aware `tenantPrisma`
 * client in the composition root; the transaction client inherits the tenant
 * extension.
 */
export class PrismaSaleUnitOfWork implements ISaleUnitOfWork {
  constructor(
    private readonly prisma: TransactionalPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async execute<T>(work: (ctx: SaleTransactionContext) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const ctx: SaleTransactionContext = {
        sales: new PrismaSaleRepository(tx, this.currency),
      };
      return work(ctx);
    });
  }
}
