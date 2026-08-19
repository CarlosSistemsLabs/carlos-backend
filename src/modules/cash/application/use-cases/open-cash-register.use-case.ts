import { Money } from '@shared/value-objects/money.js';
import { Cash } from '../../domain/entities/cash.js';
import { CashMovement } from '../../domain/entities/cash-movement.js';
import type { ICashUnitOfWork } from '../../domain/repositories/cash-unit-of-work.js';
import {
  DEFAULT_CASH_CURRENCY,
  toCashOutput,
  type CashOutput,
  type OpenCashRegisterInputDto,
} from '../dto/cash-dtos.js';

/**
 * Opens a cash register for a tenant (Requirement 9.1, 10.3).
 *
 * Responsibilities:
 * 1. Create the {@link Cash} register (starting from a zero balance).
 * 2. When an opening float is supplied, book an `opening` `INCOME`
 *    {@link CashMovement} and apply it so the register's stored balance equals
 *    its ledger. A zero float opens the register with no movement — a movement
 *    must be strictly positive, so there is nothing to record.
 * 3. Persist the register and the opening movement **atomically** in a single
 *    transaction ({@link ICashUnitOfWork}); a partial write can never leave a
 *    register whose balance disagrees with its ledger.
 *
 * The register lifecycle is modelled through the movement *category* (`opening`)
 * rather than a status column, which the `Cash` table does not have.
 */
export class OpenCashRegisterUseCase {
  constructor(private readonly unitOfWork: ICashUnitOfWork) {}

  async execute(input: OpenCashRegisterInputDto): Promise<CashOutput> {
    const currency = input.currency ?? DEFAULT_CASH_CURRENCY;
    const openingBalance =
      input.openingBalance === undefined
        ? Money.zero(currency)
        : Money.fromDecimal(input.openingBalance, currency);

    const cash = Cash.create({
      tenantId: input.tenantId,
      name: input.name,
      currency,
      branchId: input.branchId ?? null,
    });

    // Book the opening float (if any) as a movement and apply it so the stored
    // balance reconciles with the ledger.
    let openingMovement: CashMovement | null = null;
    if (openingBalance.isPositive()) {
      openingMovement = CashMovement.create({
        cashId: cash.id,
        tenantId: input.tenantId,
        userId: input.userId,
        type: 'INCOME',
        category: 'opening',
        amount: openingBalance,
        description: input.description ?? 'Opening balance',
      });
      cash.applyMovement(openingMovement);
    }

    const created = await this.unitOfWork.execute(async ({ cash: cashRepo, movements }) => {
      const persisted = await cashRepo.create(cash);
      if (openingMovement !== null) {
        await movements.create(openingMovement);
      }
      return persisted;
    });

    return toCashOutput(created);
  }
}
