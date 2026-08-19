import { PAGINATION } from '@shared/constants/index.js';
import type { Nullable, PaginatedResult, UUID } from '@shared/types/index.js';
import type { Money } from '@shared/value-objects/money.js';
import type { Payment } from '../../domain/entities/payment.js';
import type { PaymentMethod } from '../../domain/value-objects/payment-method.js';
import type { PaymentStatus } from '../../domain/value-objects/payment-status.js';

/**
 * Input for {@link import('../use-cases/record-payment.use-case.js').RecordPaymentUseCase}.
 *
 * Exactly one of `saleId` / `purchaseId` must be supplied — the {@link Payment}
 * entity enforces the link rule. `cashId` is only consulted for `cash`
 * payments: when present, the payment also books a register movement (INCOME for
 * a sale, EXPENSE for a purchase). A `card` / `transfer` / `check` payment never
 * touches the cash register.
 */
export interface RecordPaymentInputDto {
  tenantId: UUID;
  /** The user recording the payment; stamped on any cash-register movement. */
  userId: UUID;
  saleId?: Nullable<UUID>;
  purchaseId?: Nullable<UUID>;
  method: PaymentMethod;
  /** The amount tendered. Decimal string (e.g. `"50.00"`) or number. */
  amount: string | number;
  reference?: Nullable<string>;
  date?: Date;
  /**
   * The register to credit/debit for a `cash` payment. Ignored for other
   * methods. When omitted, a cash payment is recorded without touching any
   * register (e.g. the tenant does not run a till).
   */
  cashId?: Nullable<UUID>;
  /** ISO currency for the amounts. Defaults to the tenant base currency. */
  currency?: string;
}

/** Input for {@link import('../use-cases/get-payment-status.use-case.js').GetPaymentStatusUseCase}. */
export interface GetPaymentStatusInputDto {
  tenantId: UUID;
  /** Provide exactly one of `saleId` / `purchaseId`. */
  saleId?: Nullable<UUID>;
  purchaseId?: Nullable<UUID>;
  /** ISO currency for the amounts. Defaults to the tenant base currency. */
  currency?: string;
}

/** Input for {@link import('../use-cases/list-payments.use-case.js').ListPaymentsUseCase}. */
export interface ListPaymentsInputDto {
  tenantId: UUID;
  saleId?: UUID;
  purchaseId?: UUID;
  method?: PaymentMethod;
  /** Inclusive lower bound on the payment date. */
  from?: Date;
  /** Inclusive upper bound on the payment date. */
  to?: Date;
  page?: number;
  pageSize?: number;
}

/** Public projection of a payment. Money is exposed as a decimal string. */
export interface PaymentOutput {
  id: UUID;
  tenantId: UUID;
  saleId: Nullable<UUID>;
  purchaseId: Nullable<UUID>;
  method: string;
  amount: string;
  reference: Nullable<string>;
  date: string;
}

/** Public projection of a document's payment status and balances. */
export interface PaymentStatusOutput {
  /** `sale` when the status is for a sale, `purchase` for a purchase. */
  documentType: 'sale' | 'purchase';
  documentId: UUID;
  /** The billed total of the document. */
  total: string;
  /** The sum of payments recorded so far. */
  paid: string;
  /** `total - paid`, clamped at zero (never negative). */
  outstanding: string;
  status: PaymentStatus;
}

/** Pagination metadata for a page of results. */
export interface PageMeta {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** A page of projected results plus navigation metadata. */
export interface PagedResult<T> {
  items: T[];
  meta: PageMeta;
}

/** Resolved pagination values (page >= 1, pageSize clamped to platform bounds). */
export interface NormalizedPagination {
  page: number;
  pageSize: number;
}

/**
 * Clamps client-supplied pagination to the platform bounds (Requirement 26.5):
 * default page size 20, maximum 100, minimum page 1. Non-finite or out-of-range
 * values are coerced to the nearest valid value rather than rejected.
 */
export function normalizePagination(
  page: number | undefined,
  pageSize: number | undefined,
): NormalizedPagination {
  const resolvedPage =
    page === undefined || !Number.isFinite(page) || page < PAGINATION.DEFAULT_PAGE
      ? PAGINATION.DEFAULT_PAGE
      : Math.floor(page);

  let resolvedPageSize: number;
  if (pageSize === undefined || !Number.isFinite(pageSize)) {
    resolvedPageSize = PAGINATION.DEFAULT_PAGE_SIZE;
  } else {
    const floored = Math.floor(pageSize);
    if (floored < PAGINATION.MIN_PAGE_SIZE) {
      resolvedPageSize = PAGINATION.MIN_PAGE_SIZE;
    } else if (floored > PAGINATION.MAX_PAGE_SIZE) {
      resolvedPageSize = PAGINATION.MAX_PAGE_SIZE;
    } else {
      resolvedPageSize = floored;
    }
  }

  return { page: resolvedPage, pageSize: resolvedPageSize };
}

/** Maps a {@link Payment} to its public projection. */
export function toPaymentOutput(payment: Payment): PaymentOutput {
  return {
    id: payment.id,
    tenantId: payment.tenantId,
    saleId: payment.saleId,
    purchaseId: payment.purchaseId,
    method: payment.method,
    amount: payment.amount.toDecimalString(),
    reference: payment.reference,
    date: payment.date.toISOString(),
  };
}

/** Maps a page of {@link Payment}s to their public paged projection. */
export function toPagedPaymentOutput(page: PaginatedResult<Payment>): PagedResult<PaymentOutput> {
  return {
    items: page.items.map(toPaymentOutput),
    meta: {
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
      totalPages: page.totalPages,
    },
  };
}

/** Assembles a {@link PaymentStatusOutput} from a document's total, paid sum and status. */
export function toPaymentStatusOutput(
  documentType: 'sale' | 'purchase',
  documentId: UUID,
  total: Money,
  paid: Money,
  outstanding: Money,
  status: PaymentStatus,
): PaymentStatusOutput {
  return {
    documentType,
    documentId,
    total: total.toDecimalString(),
    paid: paid.toDecimalString(),
    outstanding: outstanding.toDecimalString(),
    status,
  };
}
