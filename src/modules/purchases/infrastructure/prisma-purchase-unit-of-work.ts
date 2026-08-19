import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type {
  IPurchaseUnitOfWork,
  PurchaseTransactionContext,
} from '../domain/repositories/purchase-unit-of-work.js';
import {
  PrismaPurchaseRepository,
  type PurchasePrismaClient,
} from './prisma-purchase-repository.js';

/** A transaction client exposing the delegates the purchase repository needs. */
export type PurchaseTransactionClient = PurchasePrismaClient;

/**
 * A Prisma-like client capable of running an interactive transaction. Kept
 * structural so the unit-of-work can be exercised with a fake in tests without
 * importing the full `PrismaClient` type.
 */
export interface TransactionalPrismaClient {
  $transaction<T>(fn: (tx: PurchaseTransactionClient) => Promise<T>): Promise<T>;
}

/**
 * Prisma-backed {@link IPurchaseUnitOfWork}.
 *
 * Wraps the callback in a Prisma `$transaction` and constructs a
 * transaction-scoped {@link PrismaPurchaseRepository} over the transaction
 * client `tx`, so allocating the purchase number and inserting the purchase
 * header + lines commit or roll back atomically. Bound to the tenant-aware
 * `tenantPrisma` client in the composition root; the transaction client
 * inherits the tenant extension.
 */
export class PrismaPurchaseUnitOfWork implements IPurchaseUnitOfWork {
  constructor(
    private readonly prisma: TransactionalPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async execute<T>(work: (ctx: PurchaseTransactionContext) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const ctx: PurchaseTransactionContext = {
        purchases: new PrismaPurchaseRepository(tx, this.currency),
      };
      return work(ctx);
    });
  }
}
