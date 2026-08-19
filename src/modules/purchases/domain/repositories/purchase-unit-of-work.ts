import type { IPurchaseRepository } from './purchase-repository.js';

/**
 * The transaction-scoped repositories handed to a unit-of-work callback. Writes
 * performed through them commit or roll back together.
 */
export interface PurchaseTransactionContext {
  purchases: IPurchaseRepository;
}

/**
 * Unit-of-work port for atomic purchase creation (Requirement 9.1, 10.3).
 *
 * Generating the next purchase number and inserting the purchase header plus
 * every line item must be **atomic**: a partial write would leave an orphaned
 * header or skip a number. The concrete implementation wraps the work in a
 * Prisma `$transaction` so either every write lands or none does. The domain
 * depends only on this port, keeping the transaction mechanism in
 * infrastructure (Clean Architecture, Requirement 3.2).
 */
export interface IPurchaseUnitOfWork {
  /**
   * Runs `work` inside a single transaction, providing a transaction-scoped
   * purchase repository. Resolves with the callback's result once committed; if
   * the callback throws, the transaction is rolled back and the error propagates.
   */
  execute<T>(work: (ctx: PurchaseTransactionContext) => Promise<T>): Promise<T>;
}
