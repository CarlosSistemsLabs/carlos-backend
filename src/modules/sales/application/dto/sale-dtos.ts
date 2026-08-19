import { PAGINATION, TENANT_DEFAULTS } from '@shared/constants/index.js';
import type { Nullable, PaginatedResult, SortDirection, UUID } from '@shared/types/index.js';
import type { Sale } from '../../domain/entities/sale.js';
import type { SaleDetail } from '../../domain/entities/sale-detail.js';
import type { SaleSortField } from '../../domain/repositories/sale-repository.js';
import type { SaleStatus } from '../../domain/value-objects/sale-status.js';

/**
 * Default ISO-4217 currency applied to sale money amounts.
 *
 * `Sale`/`SaleDetail` persist money as bare `Decimal` columns (no currency
 * column), so a currency must be supplied when rehydrating {@link import(
 * '@shared/value-objects/money.js').Money}. Amounts are denominated in the
 * tenant's base currency; absent a per-request tenant currency this falls back
 * to the platform default (`ARS`, see {@link TENANT_DEFAULTS}).
 */
export const DEFAULT_SALE_CURRENCY = TENANT_DEFAULTS.CURRENCY;

/** A requested line on a new sale. Pricing is resolved from the catalogue. */
export interface CreateSaleLineInputDto {
  productId: UUID;
  /** Units to sell. Must be a positive integer. */
  quantity: number;
}

/** Input for {@link import('../use-cases/create-sale.use-case.js').CreateSaleUseCase}. */
export interface CreateSaleInputDto {
  tenantId: UUID;
  customerId: UUID;
  userId: UUID;
  branchId?: Nullable<UUID>;
  items: CreateSaleLineInputDto[];
  notes?: Nullable<string>;
  saleDate?: Date;
  /**
   * Desired final status. Defaults to `completed` (which buffers the
   * `SaleCompleted` event). `draft` leaves the sale open; `cancelled` is not a
   * valid creation status.
   */
  status?: Extract<SaleStatus, 'draft' | 'completed'>;
  /** ISO currency for the money amounts. Defaults to {@link DEFAULT_SALE_CURRENCY}. */
  currency?: string;
}

/** Input for {@link import('../use-cases/get-sale.use-case.js').GetSaleUseCase}. */
export interface GetSaleInputDto {
  id: UUID;
  tenantId: UUID;
}

/** Input for {@link import('../use-cases/delete-sale.use-case.js').DeleteSaleUseCase}. */
export interface DeleteSaleInputDto {
  id: UUID;
  tenantId: UUID;
}

/**
 * Input for
 * {@link import('../use-cases/update-sale-status.use-case.js').UpdateSaleStatusUseCase}.
 *
 * The `status` is the desired target; the aggregate's state machine validates
 * the transition. `cancelled` voids the sale; `completed` finalises a draft
 * (and drives the stock decrement). `draft` is never a legal target.
 */
export interface UpdateSaleStatusInputDto {
  id: UUID;
  tenantId: UUID;
  status: SaleStatus;
}

/**
 * Input for {@link import('../use-cases/list-sales.use-case.js').ListSalesUseCase}.
 *
 * `branchId` may be `null` to match sales with no branch. The `from`/`to` bounds
 * are inclusive on `saleDate`.
 */
export interface ListSalesInputDto {
  tenantId: UUID;
  page?: number;
  pageSize?: number;
  customerId?: UUID;
  branchId?: Nullable<UUID>;
  status?: SaleStatus;
  from?: Date;
  to?: Date;
  sortBy?: SaleSortField;
  sortDirection?: SortDirection;
}

/** Public projection of a sale line. Money is exposed as decimal strings. */
export interface SaleLineOutput {
  id: UUID;
  productId: UUID;
  quantity: number;
  unitPrice: string;
  taxRate: number;
  subtotal: string;
  taxAmount: string;
  total: string;
}

/** Public projection of a sale. Money is exposed as decimal strings. */
export interface SaleOutput {
  id: UUID;
  tenantId: UUID;
  customerId: UUID;
  branchId: Nullable<UUID>;
  userId: UUID;
  saleNumber: string;
  saleDate: string;
  status: SaleStatus;
  currency: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  notes: Nullable<string>;
  items: SaleLineOutput[];
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

/** Maps a {@link SaleDetail} to its public projection. */
export function toSaleLineOutput(line: SaleDetail): SaleLineOutput {
  return {
    id: line.id,
    productId: line.productId,
    quantity: line.quantity,
    unitPrice: line.unitPrice.toDecimalString(),
    taxRate: line.taxRate,
    subtotal: line.subtotal.toDecimalString(),
    taxAmount: line.taxAmount.toDecimalString(),
    total: line.total.toDecimalString(),
  };
}

/** Maps a {@link Sale} aggregate to its public projection. */
export function toSaleOutput(sale: Sale): SaleOutput {
  const totals = sale.recalculateTotals();
  return {
    id: sale.id,
    tenantId: sale.tenantId,
    customerId: sale.customerId,
    branchId: sale.branchId,
    userId: sale.userId,
    saleNumber: sale.saleNumber,
    saleDate: sale.saleDate.toISOString(),
    status: sale.status,
    currency: sale.currency,
    subtotal: totals.subtotal.toDecimalString(),
    taxAmount: totals.taxAmount.toDecimalString(),
    total: totals.total.toDecimalString(),
    notes: sale.notes,
    items: sale.items.map(toSaleLineOutput),
  };
}

/** Maps a repository {@link PaginatedResult} of sales to a projected page. */
export function toPagedSaleOutput(result: PaginatedResult<Sale>): PagedResult<SaleOutput> {
  return {
    items: result.items.map(toSaleOutput),
    meta: {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    },
  };
}
