import { PAGINATION, TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { Nullable, PaginatedResult, SortDirection, UUID } from '@shared/types/index.js';
import type { Purchase } from '../../domain/entities/purchase.js';
import type { PurchaseDetail } from '../../domain/entities/purchase-detail.js';
import type { PurchaseSortField } from '../../domain/repositories/purchase-repository.js';
import type { PurchaseStatus } from '../../domain/value-objects/purchase-status.js';

/**
 * Default ISO-4217 currency applied to purchase money amounts.
 *
 * `Purchase`/`PurchaseDetail` persist money as bare `Decimal` columns (no
 * currency column), so a currency must be supplied when rehydrating {@link
 * import('@shared/value-objects/money.js').Money}. Amounts are denominated in
 * the tenant's base currency; absent a per-request tenant currency this falls
 * back to the platform default (`ARS`, see {@link TENANT_DEFAULTS}).
 */
export const DEFAULT_PURCHASE_CURRENCY = TENANT_DEFAULTS.CURRENCY;

/**
 * A requested line on a new purchase.
 *
 * Cost is resolved from the catalogue (`Product.cost`) by default. When the
 * catalogue cost is absent (nullable column), a client may supply {@link
 * unitCost} as a negotiated override; see the cost-source decision on
 * {@link import('../../domain/ports/purchase-product-reader.js').IPurchaseProductReader}.
 */
export interface CreatePurchaseLineInputDto {
  productId: UUID;
  /** Units to purchase. Must be a positive integer. */
  quantity: number;
  /**
   * Optional unit-cost fallback as a decimal string (e.g. `"12.50"`) or number.
   * Used only when the catalogue `Product.cost` is absent — the authoritative
   * catalogue cost always takes precedence when present.
   */
  unitCost?: string | number;
}

/** Input for {@link import('../use-cases/create-purchase.use-case.js').CreatePurchaseUseCase}. */
export interface CreatePurchaseInputDto {
  tenantId: UUID;
  supplierId: UUID;
  userId: UUID;
  items: CreatePurchaseLineInputDto[];
  notes?: Nullable<string>;
  purchaseDate?: Date;
  /**
   * Desired final status. Defaults to `completed` (which buffers the
   * `PurchaseCompleted` event). `draft` leaves the purchase open; `cancelled`
   * is not a valid creation status.
   */
  status?: Extract<PurchaseStatus, 'draft' | 'completed'>;
  /** ISO currency for the money amounts. Defaults to {@link DEFAULT_PURCHASE_CURRENCY}. */
  currency?: string;
}

/** Input for {@link import('../use-cases/get-purchase.use-case.js').GetPurchaseUseCase}. */
export interface GetPurchaseInputDto {
  id: UUID;
  tenantId: UUID;
}

/** Input for {@link import('../use-cases/delete-purchase.use-case.js').DeletePurchaseUseCase}. */
export interface DeletePurchaseInputDto {
  id: UUID;
  tenantId: UUID;
}

/**
 * Input for a purchase status transition. The `status` is the desired target;
 * the aggregate's state machine validates the transition. `cancelled` voids the
 * purchase; `completed` finalises a draft (and drives the stock increment).
 * `draft` is never a legal target.
 */
export interface UpdatePurchaseStatusInputDto {
  id: UUID;
  tenantId: UUID;
  status: PurchaseStatus;
}

/**
 * Input for a purchase listing.
 *
 * The `from`/`to` bounds are inclusive on `purchaseDate`.
 */
export interface ListPurchasesInputDto {
  tenantId: UUID;
  page?: number;
  pageSize?: number;
  supplierId?: UUID;
  status?: PurchaseStatus;
  from?: Date;
  to?: Date;
  sortBy?: PurchaseSortField;
  sortDirection?: SortDirection;
}

/** Public projection of a purchase line. Money is exposed as decimal strings. */
export interface PurchaseLineOutput {
  id: UUID;
  productId: UUID;
  quantity: number;
  unitCost: string;
  taxRate: number;
  subtotal: string;
  taxAmount: string;
  total: string;
}

/** Public projection of a purchase. Money is exposed as decimal strings. */
export interface PurchaseOutput {
  id: UUID;
  tenantId: UUID;
  supplierId: UUID;
  userId: UUID;
  purchaseNumber: string;
  purchaseDate: string;
  status: PurchaseStatus;
  currency: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  notes: Nullable<string>;
  items: PurchaseLineOutput[];
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

/** Maps a {@link PurchaseDetail} to its public projection. */
export function toPurchaseLineOutput(line: PurchaseDetail): PurchaseLineOutput {
  return {
    id: line.id,
    productId: line.productId,
    quantity: line.quantity,
    unitCost: line.unitCost.toDecimalString(),
    taxRate: line.taxRate,
    subtotal: line.subtotal.toDecimalString(),
    taxAmount: line.taxAmount.toDecimalString(),
    total: line.total.toDecimalString(),
  };
}

/** Maps a {@link Purchase} aggregate to its public projection. */
export function toPurchaseOutput(purchase: Purchase): PurchaseOutput {
  const totals = purchase.recalculateTotals();
  return {
    id: purchase.id,
    tenantId: purchase.tenantId,
    supplierId: purchase.supplierId,
    userId: purchase.userId,
    purchaseNumber: purchase.purchaseNumber,
    purchaseDate: purchase.purchaseDate.toISOString(),
    status: purchase.status,
    currency: purchase.currency,
    subtotal: totals.subtotal.toDecimalString(),
    taxAmount: totals.taxAmount.toDecimalString(),
    total: totals.total.toDecimalString(),
    notes: purchase.notes,
    items: purchase.items.map(toPurchaseLineOutput),
  };
}

/** Maps a repository {@link PaginatedResult} of purchases to a projected page. */
export function toPagedPurchaseOutput(
  result: PaginatedResult<Purchase>,
): PagedResult<PurchaseOutput> {
  return {
    items: result.items.map(toPurchaseOutput),
    meta: {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    },
  };
}
