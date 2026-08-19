import type {
  IStockUnitOfWork,
  StockTransactionContext,
} from '../domain/repositories/stock-unit-of-work.js';
import { PrismaStockRepository, type StockPrismaClient } from './prisma-stock-repository.js';
import {
  PrismaStockMovementRepository,
  type StockMovementPrismaClient,
} from './prisma-stock-movement-repository.js';

/** A transaction client exposing the delegates the stock repositories need. */
export type StockTransactionClient = StockPrismaClient & StockMovementPrismaClient;

/**
 * A Prisma-like client capable of running an interactive transaction. Kept
 * structural so the unit-of-work can be exercised with a fake in tests without
 * importing the full `PrismaClient` type.
 */
export interface TransactionalPrismaClient {
  $transaction<T>(fn: (tx: StockTransactionClient) => Promise<T>): Promise<T>;
}

/**
 * Prisma-backed {@link IStockUnitOfWork}.
 *
 * Wraps the callback in a Prisma `$transaction` and constructs
 * transaction-scoped {@link PrismaStockRepository} / {@link
 * PrismaStockMovementRepository} instances over the transaction client `tx`, so
 * every write inside the callback commits or rolls back atomically. Bound to
 * the tenant-aware `tenantPrisma` client in the composition root; the
 * transaction client inherits the tenant extension.
 */
export class PrismaStockUnitOfWork implements IStockUnitOfWork {
  constructor(private readonly prisma: TransactionalPrismaClient) {}

  async execute<T>(work: (ctx: StockTransactionContext) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const ctx: StockTransactionContext = {
        stocks: new PrismaStockRepository(tx),
        movements: new PrismaStockMovementRepository(tx),
      };
      return work(ctx);
    });
  }
}
