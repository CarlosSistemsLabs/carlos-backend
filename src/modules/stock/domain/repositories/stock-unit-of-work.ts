import type { IStockRepository } from './stock-repository.js';
import type { IStockMovementRepository } from './stock-movement-repository.js';

/**
 * The transaction-scoped repositories handed to a unit-of-work callback. Both
 * repositories share the same underlying transaction, so writes performed
 * through them commit or roll back together.
 */
export interface StockTransactionContext {
  stocks: IStockRepository;
  movements: IStockMovementRepository;
}

/**
 * Unit-of-work port for atomic stock operations (Requirement 9.1).
 *
 * Adjusting a balance and recording its audit movement — or, for a transfer,
 * updating two balances and recording two movements — must be **atomic**: a
 * partial write would corrupt the audit trail or leave stock inconsistent. The
 * concrete implementation wraps the work in a Prisma `$transaction` so either
 * every write lands or none does. The domain depends only on this port,
 * keeping the transaction mechanism in the infrastructure layer (Clean
 * Architecture, Requirement 3.2).
 */
export interface IStockUnitOfWork {
  /**
   * Runs `work` inside a single transaction, providing transaction-scoped
   * repositories. Resolves with the callback's result once committed; if the
   * callback throws, the transaction is rolled back and the error propagates.
   */
  execute<T>(work: (ctx: StockTransactionContext) => Promise<T>): Promise<T>;
}
