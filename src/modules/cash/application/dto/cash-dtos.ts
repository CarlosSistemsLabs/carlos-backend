import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { Nullable, PaginatedResult, UUID } from '@shared/types/index.js';
import type { Cash, CashReconciliation } from '../../domain/entities/cash.js';
import type { CashMovement } from '../../domain/entities/cash-movement.js';
import type { CashMovementType } from '../../domain/value-objects/cash-movement-type.js';
import type { CashMovementCategory } from '../../domain/value-objects/cash-movement-category.js';
import type { PagedResult } from './payment-dtos.js';

/**
 * Default ISO-4217 currency applied to cash amounts.
 *
 * `Cash`/`CashMovement`/`Payment` persist money as bare `Decimal` columns (no
 * currency column), so a currency must be supplied when rehydrating {@link
 * import('@shared/value-objects/money.js').Money}. Absent a per-request tenant
 * currency this falls back to the platform default (`ARS`).
 */
export const DEFAULT_CASH_CURRENCY = TENANT_DEFAULTS.CURRENCY;

/** Input for {@link import('../use-cases/open-cash-register.use-case.js').OpenCashRegisterUseCase}. */
export interface OpenCashRegisterInputDto {
  tenantId: UUID;
  userId: UUID;
  name: string;
  branchId?: Nullable<UUID>;
  /**
   * The opening float. Decimal string (e.g. `"100.00"`) or number. Defaults to
   * zero. When positive, an `opening` INCOME movement is booked; a zero float
   * opens the register with no movement (a movement must be positive).
   */
  openingBalance?: string | number;
  /** ISO currency for the amounts. Defaults to {@link DEFAULT_CASH_CURRENCY}. */
  currency?: string;
  /** Optional free-text note stored on the opening movement. */
  description?: Nullable<string>;
}

/** Input for {@link import('../use-cases/close-cash-register.use-case.js').CloseCashRegisterUseCase}. */
export interface CloseCashRegisterInputDto {
  tenantId: UUID;
  userId: UUID;
  cashId: UUID;
  /** The physically counted amount. Decimal string (e.g. `"250.00"`) or number. */
  countedAmount: string | number;
  /** ISO currency for the amounts. Defaults to {@link DEFAULT_CASH_CURRENCY}. */
  currency?: string;
  /** Optional free-text note stored on the closing movement. */
  description?: Nullable<string>;
}

/**
 * Input for
 * {@link import('../use-cases/record-cash-movement.use-case.js').RecordCashMovementUseCase}.
 *
 * Records a standalone movement (e.g. a manual cash withdrawal or top-up)
 * against an existing register, updating its balance atomically. `type` chooses
 * the direction (`INCOME` credits, `EXPENSE` debits — an `EXPENSE` that exceeds
 * the balance is refused by the overdraft guard); `category` classifies the
 * movement (typically `other` for ad-hoc entries).
 */
export interface RecordCashMovementInputDto {
  tenantId: UUID;
  userId: UUID;
  cashId: UUID;
  type: CashMovementType;
  category: CashMovementCategory;
  /** The (positive) amount moved. Decimal string (e.g. `"25.00"`) or number. */
  amount: string | number;
  reference?: Nullable<string>;
  description?: Nullable<string>;
  date?: Date;
  /** ISO currency for the amounts. Defaults to {@link DEFAULT_CASH_CURRENCY}. */
  currency?: string;
}

/**
 * Input for
 * {@link import('../use-cases/list-cash-movements.use-case.js').ListCashMovementsUseCase}.
 *
 * Retrieves a tenant's cash-flow history with optional filters (register,
 * direction, category, inclusive date range) and pagination.
 */
export interface ListCashMovementsInputDto {
  tenantId: UUID;
  cashId?: UUID;
  type?: CashMovementType;
  category?: CashMovementCategory;
  /** Inclusive lower bound on the movement date. */
  from?: Date;
  /** Inclusive upper bound on the movement date. */
  to?: Date;
  page?: number;
  pageSize?: number;
}

/** Public projection of a cash register. Money is exposed as decimal strings. */
export interface CashOutput {
  id: UUID;
  tenantId: UUID;
  branchId: Nullable<UUID>;
  name: string;
  currency: string;
  balance: string;
}

/** Public projection of a cash movement. Money is exposed as a decimal string. */
export interface CashMovementOutput {
  id: UUID;
  cashId: UUID;
  tenantId: UUID;
  userId: UUID;
  type: string;
  category: string;
  amount: string;
  reference: Nullable<string>;
  description: Nullable<string>;
  date: string;
}

/** Result of closing a register: the reconciliation plus the movement booked. */
export interface CloseCashRegisterOutput {
  cash: CashOutput;
  /** Expected balance (from the ledger) before reconciliation. */
  expected: string;
  /** The counted amount supplied at close. */
  counted: string;
  /** `counted - expected`: positive = overage, negative = shortage, `0.00` = clean. */
  difference: string;
  /**
   * The reconciliation movement booked to align the balance with the count, or
   * `null` when the difference was zero (no adjustment needed).
   */
  reconciliationMovement: Nullable<CashMovementOutput>;
}

/** Maps a {@link Cash} aggregate to its public projection. */
export function toCashOutput(cash: Cash): CashOutput {
  return {
    id: cash.id,
    tenantId: cash.tenantId,
    branchId: cash.branchId,
    name: cash.name,
    currency: cash.currency,
    balance: cash.balance.toDecimalString(),
  };
}

/** Maps a {@link CashMovement} to its public projection. */
export function toCashMovementOutput(movement: CashMovement): CashMovementOutput {
  return {
    id: movement.id,
    cashId: movement.cashId,
    tenantId: movement.tenantId,
    userId: movement.userId,
    type: movement.type,
    category: movement.category,
    amount: movement.amount.toDecimalString(),
    reference: movement.reference,
    description: movement.description,
    date: movement.date.toISOString(),
  };
}

/** Maps a page of {@link CashMovement}s to their public paged projection. */
export function toPagedCashMovementOutput(
  page: PaginatedResult<CashMovement>,
): PagedResult<CashMovementOutput> {
  return {
    items: page.items.map(toCashMovementOutput),
    meta: {
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      totalPages: page.totalPages,
    },
  };
}

/** Assembles a {@link CloseCashRegisterOutput} from its parts. */
export function toCloseCashRegisterOutput(
  cash: Cash,
  reconciliation: CashReconciliation,
  reconciliationMovement: CashMovement | null,
): CloseCashRegisterOutput {
  return {
    cash: toCashOutput(cash),
    expected: reconciliation.expected.toDecimalString(),
    counted: reconciliation.counted.toDecimalString(),
    difference: reconciliation.difference.toDecimalString(),
    reconciliationMovement:
      reconciliationMovement === null ? null : toCashMovementOutput(reconciliationMovement),
  };
}
