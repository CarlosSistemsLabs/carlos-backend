import { NotFoundError } from '@domain/errors/index.js';
import { Money } from '@shared/value-objects/money.js';
import { CashMovement } from '../../domain/entities/cash-movement.js';
import type { ICashRepository } from '../../domain/repositories/cash-repository.js';
import type { ICashUnitOfWork } from '../../domain/repositories/cash-unit-of-work.js';
import {
  DEFAULT_CASH_CURRENCY,
  toCashMovementOutput,
  type CashMovementOutput,
  type RecordCashMovementInputDto,
} from '../dto/cash-dtos.js';

/**
 * Records a standalone cash-register movement (Requirement 9.1, 10.3).
 *
 * Handles ad-hoc money in/out that is not driven by a sale or purchase — e.g. a
 * manual top-up (`INCOME`) or a petty-cash withdrawal (`EXPENSE`), typically
 * with category `other`. Responsibilities:
 * 1. Load the target register (tenant-scoped; a missing/foreign register is a
 *    404, {@link NotFoundError}).
 * 2. Build the movement — {@link CashMovement.create} enforces the
 *    strictly-positive amount and validates the type/category.
 * 3. Apply it to the register: `INCOME` credits, `EXPENSE` debits. An `EXPENSE`
 *    that exceeds the current balance is refused by the aggregate's overdraft
 *    guard (`InsufficientCashBalanceError`, a business-rule breach → 422), so
 *    the drawer can never go negative.
 * 4. Persist the movement and the updated balance **atomically**
 *    ({@link ICashUnitOfWork}); a partial write could otherwise leave the stored
 *    balance disagreeing with the ledger.
 *
 * The direction is carried by `type`, never the sign of the amount, mirroring
 * the open/close reconciliation flow.
 */
export class RecordCashMovementUseCase {
  constructor(
    private readonly unitOfWork: ICashUnitOfWork,
    private readonly cashRepository: ICashRepository,
  ) {}

  async execute(input: RecordCashMovementInputDto): Promise<CashMovementOutput> {
    const currency = input.currency ?? DEFAULT_CASH_CURRENCY;

    const cash = await this.cashRepository.findById(input.cashId);
    if (cash === null || cash.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Cash', input.cashId);
    }

    const amount = Money.fromDecimal(input.amount, currency);
    const movement = CashMovement.create({
      cashId: cash.id,
      tenantId: input.tenantId,
      userId: input.userId,
      type: input.type,
      category: input.category,
      amount,
      reference: input.reference ?? null,
      description: input.description ?? null,
      ...(input.date !== undefined ? { date: input.date } : {}),
    });

    // Overdraft guard: an EXPENSE beyond the balance throws here (422).
    cash.applyMovement(movement);

    const persisted = await this.unitOfWork.execute(async ({ cash: cashRepo, movements }) => {
      const created = await movements.create(movement);
      await cashRepo.updateBalance(cash.id, cash.balance);
      return created;
    });

    return toCashMovementOutput(persisted);
  }
}
