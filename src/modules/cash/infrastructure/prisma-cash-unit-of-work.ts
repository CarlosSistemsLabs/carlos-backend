import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type {
  CashTransactionContext,
  ICashUnitOfWork,
} from '../domain/repositories/cash-unit-of-work.js';
import { PrismaCashRepository, type CashPrismaClient } from './prisma-cash-repository.js';
import {
  PrismaCashMovementRepository,
  type CashMovementPrismaClient,
} from './prisma-cash-movement-repository.js';
import {
  PrismaPaymentRepository,
  type PaymentPrismaClient,
} from './prisma-payment-repository.js';

/** A transaction client exposing the delegates the cash repositories need. */
export type CashTransactionClient = CashPrismaClient &
  CashMovementPrismaClient &
  PaymentPrismaClient;

/**
 * A Prisma-like client capable of running an interactive transaction. Kept
 * structural so the unit-of-work can be exercised with a fake in tests without
 * importing the full `PrismaClient` type.
 */
export interface TransactionalPrismaClient {
  $transaction<T>(fn: (tx: CashTransactionClient) => Promise<T>): Promise<T>;
}

/**
 * Prisma-backed {@link ICashUnitOfWork}.
 *
 * Wraps the callback in a Prisma `$transaction` and constructs
 * transaction-scoped {@link PrismaCashRepository},
 * {@link PrismaCashMovementRepository} and {@link PrismaPaymentRepository} over
 * the transaction client `tx`, so opening a register (insert + opening
 * movement), closing it (reconciliation movement + balance update) and
 * recording a cash payment (payment + movement + balance update) commit or roll
 * back atomically. Bound to the
 * tenant-aware `tenantPrisma` client in the composition root; the transaction
 * client inherits the tenant extension.
 */
export class PrismaCashUnitOfWork implements ICashUnitOfWork {
  constructor(
    private readonly prisma: TransactionalPrismaClient,
    private readonly currency: string = TENANT_DEFAULTS.CURRENCY,
  ) {}

  async execute<T>(work: (ctx: CashTransactionContext) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const ctx: CashTransactionContext = {
        cash: new PrismaCashRepository(tx, this.currency),
        movements: new PrismaCashMovementRepository(tx, this.currency),
        payments: new PrismaPaymentRepository(tx, this.currency),
      };
      return work(ctx);
    });
  }
}
