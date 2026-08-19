import { NotFoundError } from '@domain/errors/index.js';
import { Money } from '@shared/value-objects/money.js';
import { CashMovement } from '../../domain/entities/cash-movement.js';
import type { CashReconciliation } from '../../domain/entities/cash.js';
import type { ICashUnitOfWork } from '../../domain/repositories/cash-unit-of-work.js';
import type { ICashRepository } from '../../domain/repositories/cash-repository.js';
import {
  DEFAULT_CASH_CURRENCY,
  toCloseCashRegisterOutput,
  type CloseCashRegisterInputDto,
  type CloseCashRegisterOutput,
} from '../dto/cash-dtos.js';

/**
 * Closes a cash register with reconciliation (Requirement 9.1, 10.3).
 *
 * Responsibilities:
 * 1. Load the register (tenant-scoped; 404 when missing).
 * 2. Reconcile the ledger's **expected** balance against the physically
 *    **counted** amount ({@link CashReconciliation}).
 * 3. Book a `closing` reconciliation {@link CashMovement} to align the stored
 *    balance with the count:
 *    - overage (`counted > expected`) → an `INCOME` for the difference;
 *    - shortage (`counted < expected`) → an `EXPENSE` for the difference;
 *    - a clean count (`difference == 0`) → no movement (a movement must be
 *      positive), the register already matches.
 * 4. Persist the movement and the updated balance **atomically**
 *    ({@link ICashUnitOfWork}).
 *
 * A shortage `EXPENSE` can never overdraw the register: the debited amount is
 * `expected - counted`, which is at most the current balance, so the overdraft
 * guard on `Cash.applyMovement` is respected.
 *
 * The register lifecycle is modelled through the `closing` movement category
 * (the `Cash` table has no status column); a register may be re-opened/closed
 * across sessions and its running balance persists.
 */
export class CloseCashRegisterUseCase {
  constructor(
    private readonly unitOfWork: ICashUnitOfWork,
    private readonly cashRepository: ICashRepository,
  ) {}

  async execute(input: CloseCashRegisterInputDto): Promise<CloseCashRegisterOutput> {
    const currency = input.currency ?? DEFAULT_CASH_CURRENCY;

    const cash = await this.cashRepository.findById(input.cashId);
    if (cash === null || cash.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Cash', input.cashId);
    }

    const counted = Money.fromDecimal(input.countedAmount, currency);
    const reconciliation: CashReconciliation = cash.reconcile(counted);

    // Derive the reconciliation movement from the difference.
    const movement = this.buildReconciliationMovement(input, reconciliation);
    if (movement === null) {
      // Clean count: nothing to persist, the stored balance already matches.
      return toCloseCashRegisterOutput(cash, reconciliation, null);
    }

    cash.applyMovement(movement);

    await this.unitOfWork.execute(async ({ cash: cashRepo, movements }) => {
      await movements.create(movement);
      await cashRepo.updateBalance(cash.id, cash.balance);
    });

    return toCloseCashRegisterOutput(cash, reconciliation, movement);
  }

  /**
   * Builds the `closing` movement that aligns the balance with the count, or
   * `null` when the count matches the expected balance exactly.
   */
  private buildReconciliationMovement(
    input: CloseCashRegisterInputDto,
    reconciliation: CashReconciliation,
  ): CashMovement | null {
    const { difference } = reconciliation;
    if (difference.isZero()) {
      return null;
    }
    const isOverage = difference.isPositive();
    const amount = isOverage ? difference : difference.multiply(-1);
    return CashMovement.create({
      cashId: input.cashId,
      tenantId: input.tenantId,
      userId: input.userId,
      type: isOverage ? 'INCOME' : 'EXPENSE',
      category: 'closing',
      amount,
      description: input.description ?? (isOverage ? 'Closing overage' : 'Closing shortage'),
    });
  }
}
