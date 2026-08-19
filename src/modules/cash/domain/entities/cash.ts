import { AggregateRoot } from '@domain/entities/aggregate-root.js';
import { ValidationError } from '@domain/errors/index.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import type { CashMovement } from './cash-movement.js';
import { CashMovementMismatchError, InsufficientCashBalanceError } from '../errors/cash-errors.js';

/** The outcome of reconciling a register's expected balance against a count. */
export interface CashReconciliation {
  /** The balance the ledger says the register should hold. */
  expected: Money;
  /** The physically counted amount supplied at close. */
  counted: Money;
  /**
   * `counted - expected`. Positive = overage (more cash than expected), negative
   * = shortage (less cash than expected), zero = a clean reconciliation.
   */
  difference: Money;
}

/** Attributes describing a cash register. */
export interface CashProps {
  tenantId: UUID;
  branchId: Nullable<UUID>;
  name: string;
  /** On-hand balance. Never negative (see the overdraft policy on {@link Cash.applyMovement}). */
  balance: Money;
  /** ISO currency the balance and all movement amounts are denominated in. */
  currency: string;
}

/** Input accepted by {@link Cash.create} when opening a new register. */
export interface CreateCashInput {
  tenantId: UUID;
  name: string;
  currency: string;
  branchId?: Nullable<UUID>;
  /** Initial balance. Defaults to zero; must not be negative. */
  balance?: Money;
}

/**
 * Cash register aggregate root (Requirement 9.1).
 *
 * A register is a named drawer holding a {@link Money} balance. It owns balance
 * mutation: {@link applyMovement} is the single entry point, so the balance
 * always reflects the ledger of {@link CashMovement}s applied to it.
 *
 * **No status column — lifecycle via movements.** The `Cash` table has no
 * open/closed flag, so the register lifecycle is modelled through movement
 * *categories* rather than aggregate state: opening a register books an
 * `opening` movement (see `OpenCashRegisterUseCase`) and closing books a
 * `closing` reconciliation (see `CloseCashRegisterUseCase`). The aggregate
 * itself is a running ledger balance, not a state machine.
 *
 * **Overdraft policy.** A register mirrors physical cash, which cannot be
 * negative. {@link applyMovement} rejects an `EXPENSE` that exceeds the current
 * balance ({@link InsufficientCashBalanceError}); `INCOME` always succeeds.
 *
 * All arithmetic uses integer-safe {@link Money}, so there is no float drift and
 * the persisted `balance` column always reconciles with the applied movements.
 */
export class Cash extends AggregateRoot<CashProps> {
  private constructor(props: CashProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Opens a new register with an optional starting balance (default zero).
   *
   * @throws {ValidationError} when the name is blank or the starting balance is
   *   negative or in a different currency than the register.
   */
  static create(input: CreateCashInput, id?: UUID): Cash {
    const name = Cash.assertName(input.name);
    const currency = Money.zero(input.currency).currency; // validates + normalises
    const balance = input.balance ?? Money.zero(currency);
    if (balance.currency !== currency) {
      throw new ValidationError('Cash balance currency must match the register currency', {
        registerCurrency: currency,
        balanceCurrency: balance.currency,
      });
    }
    if (balance.isNegative()) {
      throw new ValidationError('Cash balance cannot be negative', {
        balance: balance.toString(),
      });
    }
    return new Cash(
      {
        tenantId: input.tenantId,
        branchId: input.branchId ?? null,
        name,
        balance,
        currency,
      },
      id,
    );
  }

  /**
   * Rehydrates a {@link Cash} register from already-validated persisted state.
   * Trusts the data store and performs no re-validation.
   */
  static reconstitute(id: UUID, props: CashProps): Cash {
    return new Cash({ ...props }, id);
  }

  get tenantId(): UUID {
    return this.props.tenantId;
  }

  get branchId(): Nullable<UUID> {
    return this.props.branchId;
  }

  get name(): string {
    return this.props.name;
  }

  get balance(): Money {
    return this.props.balance;
  }

  get currency(): string {
    return this.props.currency;
  }

  /**
   * Applies a movement to the register, crediting an `INCOME` and debiting an
   * `EXPENSE`. This is the only way the balance changes.
   *
   * @throws {CashMovementMismatchError} when the movement belongs to another
   *   register.
   * @throws {ValidationError} when the movement currency differs from the
   *   register's.
   * @throws {InsufficientCashBalanceError} when an `EXPENSE` exceeds the current
   *   balance (overdraft policy).
   */
  applyMovement(movement: CashMovement): void {
    if (movement.cashId !== this.id) {
      throw new CashMovementMismatchError(this.id, movement.cashId);
    }
    if (movement.amount.currency !== this.props.currency) {
      throw new ValidationError('Cash movement currency must match the register currency', {
        registerCurrency: this.props.currency,
        movementCurrency: movement.amount.currency,
      });
    }
    if (movement.type === 'EXPENSE' && movement.amount.greaterThan(this.props.balance)) {
      throw new InsufficientCashBalanceError(
        this.props.balance.toString(),
        movement.amount.toString(),
        this.props.currency,
      );
    }
    this.props.balance = this.props.balance.add(movement.signedAmount);
  }

  /**
   * Reconciles the current (expected) balance against a physically counted
   * amount, returning the expected/counted/difference triple. Pure — it does
   * not mutate the register; the caller decides how to book any difference (see
   * `CloseCashRegisterUseCase`).
   *
   * @throws {ValidationError} when the counted amount is in a different currency.
   */
  reconcile(counted: Money): CashReconciliation {
    if (counted.currency !== this.props.currency) {
      throw new ValidationError('Counted amount currency must match the register currency', {
        registerCurrency: this.props.currency,
        countedCurrency: counted.currency,
      });
    }
    return {
      expected: this.props.balance,
      counted,
      difference: counted.subtract(this.props.balance),
    };
  }

  private static assertName(name: string): string {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('Cash register name is required', { name });
    }
    return name.trim();
  }
}
