import type { ISaleRepository } from './sale-repository.js';

/**
 * The transaction-scoped repositories handed to a unit-of-work callback. Writes
 * performed through them commit or roll back together.
 */
export interface SaleTransactionContext {
  sales: ISaleRepository;
}

/**
 * Unit-of-work port for atomic sale creation (Requirement 9.1).
 *
 * Generating the next sale number and inserting the sale header plus every line
 * item must be **atomic**: a partial write would leave an orphaned header or
 * skip a number. The concrete implementation wraps the work in a Prisma
 * `$transaction` so either every write lands or none does. The domain depends
 * only on this port, keeping the transaction mechanism in infrastructure (Clean
 * Architecture, Requirement 3.2).
 */
export interface ISaleUnitOfWork {
  /**
   * Runs `work` inside a single transaction, providing a transaction-scoped
   * sale repository. Resolves with the callback's result once committed; if the
   * callback throws, the transaction is rolled back and the error propagates.
   */
  execute<T>(work: (ctx: SaleTransactionContext) => Promise<T>): Promise<T>;
}
