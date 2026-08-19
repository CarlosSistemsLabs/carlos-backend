import type { ICashRepository } from './cash-repository.js';
import type { ICashMovementRepository } from './cash-movement-repository.js';
import type { IPaymentRepository } from './payment-repository.js';

/**
 * The transaction-scoped repositories handed to a unit-of-work callback. All
 * repositories share the same underlying transaction, so writes performed
 * through them commit or roll back together.
 *
 * `payments` is included so `RecordPaymentUseCase` can persist a payment and its
 * matching cash-register movement (INCOME for a sale, EXPENSE for a purchase)
 * atomically — a partial write could otherwise record a payment whose cash
 * movement never landed (or vice versa).
 */
export interface CashTransactionContext {
  cash: ICashRepository;
  movements: ICashMovementRepository;
  payments: IPaymentRepository;
}

/**
 * Unit-of-work port for atomic cash operations (Requirement 9.1).
 *
 * Opening a register (insert the register + book the opening movement) and
 * closing it (book the reconciliation movement + update the balance) must be
 * **atomic**: a partial write would leave a register whose stored balance does
 * not match its ledger. The concrete implementation wraps the work in a Prisma
 * `$transaction` so either every write lands or none does. The domain depends
 * only on this port, keeping the transaction mechanism in infrastructure (Clean
 * Architecture, Requirement 3.2).
 */
export interface ICashUnitOfWork {
  /**
   * Runs `work` inside a single transaction, providing transaction-scoped
   * repositories. Resolves with the callback's result once committed; if the
   * callback throws, the transaction is rolled back and the error propagates.
   */
  execute<T>(work: (ctx: CashTransactionContext) => Promise<T>): Promise<T>;
}
