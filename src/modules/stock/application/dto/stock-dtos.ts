import { PAGINATION } from '@shared/constants/index.js';
import type { CursorPage } from '@shared/pagination/cursor.js';
import type { ISODateString, Nullable, PaginatedResult, UUID } from '@shared/types/index.js';
import type { Stock } from '../../domain/entities/stock.js';
import type { StockMovement } from '../../domain/entities/stock-movement.js';
import type { StockLevelView } from '../../domain/repositories/stock-repository.js';
import type { StockMovementType } from '../../domain/value-objects/stock-movement-type.js';

/** Input for `AdjustStockUseCase`. */
export interface AdjustStockInputDto {
  tenantId: UUID;
  productId: UUID;
  /** Source branch; `null`/omitted targets the tenant-wide balance. */
  branchId?: Nullable<UUID>;
  /** One of `IN` | `OUT` | `ADJUSTMENT` | `TRANSFER`. */
  type: StockMovementType | string;
  /** Number of units to move. Must be a positive integer. */
  quantity: number;
  /** Optional link to the originating document (sale id, purchase id, ...). */
  reference?: Nullable<string>;
  notes?: Nullable<string>;
  /**
   * Destination branch for a `TRANSFER`. Required (and must differ from
   * {@link branchId}) when `type === 'TRANSFER'`; ignored otherwise.
   */
  destinationBranchId?: Nullable<UUID>;
}

/**
 * Input for `RecordStockMovementUseCase` — the referenced-movement API other
 * modules (and event handlers) use to apply a single-leg movement tied to an
 * originating document.
 */
export interface RecordStockMovementInputDto {
  tenantId: UUID;
  productId: UUID;
  /** Branch affected; `null`/omitted targets the tenant-wide balance. */
  branchId?: Nullable<UUID>;
  /**
   * The movement direction. Only single-leg movements are recordable here:
   * `IN` (e.g. purchase), `OUT` (e.g. sale) or `ADJUSTMENT`. `TRANSFER` is a
   * two-branch operation and must go through `AdjustStockUseCase` directly.
   */
  type: 'IN' | 'OUT' | 'ADJUSTMENT';
  /** Number of units to move. Must be a positive integer. */
  quantity: number;
  /**
   * Required link to the originating document, e.g. `sale:<id>` or
   * `purchase:<id>`. This is the distinguishing feature of a recorded movement.
   */
  reference: string;
  notes?: Nullable<string>;
}

/** Input for `GetStockMovementHistoryUseCase`. */
export interface GetStockMovementHistoryInputDto {
  tenantId: UUID;
  page?: number;
  pageSize?: number;
  /** Restrict to a single product. */
  productId?: UUID;
  /** Restrict to a branch, or `null` for tenant-wide movements. */
  branchId?: Nullable<UUID>;
  /** Restrict to a single movement type. */
  type?: StockMovementType | string;
  /** Inclusive lower bound on `createdAt`. */
  from?: Date;
  /** Inclusive upper bound on `createdAt`. */
  to?: Date;
}

/**
 * Input for `ListStockMovementsByCursorUseCase` — the cursor-paginated variant
 * of the movement history for large datasets (Requirement 26.6). Mirrors the
 * offset filters but replaces `page`/`pageSize` with an opaque `cursor` and a
 * `limit`.
 */
export interface ListStockMovementsByCursorInputDto {
  tenantId: UUID;
  /** Opaque cursor from a previous page; omit for the first page. */
  cursor?: string;
  /** Page size; clamped to the platform bounds (default 20, max 100). */
  limit?: number;
  /** Restrict to a single product. */
  productId?: UUID;
  /** Restrict to a branch, or `null` for tenant-wide movements. */
  branchId?: Nullable<UUID>;
  /** Restrict to a single movement type. */
  type?: StockMovementType | string;
  /** Inclusive lower bound on `createdAt`. */
  from?: Date;
  /** Inclusive upper bound on `createdAt`. */
  to?: Date;
}

/** Input for `GetStockLevelsUseCase`. */
export interface GetStockLevelsInputDto {
  tenantId: UUID;
  page?: number;
  pageSize?: number;
  productId?: UUID;
  branchId?: Nullable<UUID>;
  /** When `true`, only balances at or below their `minStock` are returned. */
  lowStockOnly?: boolean;
}

/** Public projection of a stock balance. */
export interface StockOutput {
  id: UUID;
  tenantId: UUID;
  productId: UUID;
  branchId: Nullable<UUID>;
  quantity: number;
}

/** Public projection of a stock-movement audit record. */
export interface StockMovementOutput {
  id: UUID;
  tenantId: UUID;
  productId: UUID;
  branchId: Nullable<UUID>;
  type: StockMovementType;
  quantity: number;
  reference: Nullable<string>;
  notes: Nullable<string>;
  createdAt: ISODateString;
}

/**
 * Result of an adjustment. Contains the affected balance(s) and the recorded
 * movement(s): one each for `IN`/`OUT`/`ADJUSTMENT`, two each for `TRANSFER`
 * (source + destination).
 */
export interface AdjustStockOutput {
  stocks: StockOutput[];
  movements: StockMovementOutput[];
}

/** A stock level enriched with its low-stock evaluation. */
export interface StockLevelOutput {
  productId: UUID;
  branchId: Nullable<UUID>;
  quantity: number;
  productName: string;
  minStock: number;
  /** `true` when `quantity <= minStock`. */
  lowStock: boolean;
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

/**
 * A cursor-paginated page of projected results (Requirement 26.6). `nextCursor`
 * is the opaque token to fetch the following page, or `null` on the last page.
 */
export interface CursorPagedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Resolved pagination values (page >= 1, pageSize clamped to platform bounds). */
export interface NormalizedPagination {
  page: number;
  pageSize: number;
}

/**
 * Clamps client-supplied pagination to the platform bounds (Requirement 26.5):
 * default page size 20, maximum 100, minimum page 1. Out-of-range values are
 * coerced to the nearest valid value rather than rejected.
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

/** Maps a {@link Stock} aggregate to its public projection. */
export function toStockOutput(stock: Stock): StockOutput {
  return {
    id: stock.id,
    tenantId: stock.tenantId,
    productId: stock.productId,
    branchId: stock.branchId,
    quantity: stock.quantity,
  };
}

/** Maps a {@link StockMovement} entity to its public projection. */
export function toStockMovementOutput(movement: StockMovement): StockMovementOutput {
  return {
    id: movement.id,
    tenantId: movement.tenantId,
    productId: movement.productId,
    branchId: movement.branchId,
    type: movement.type,
    quantity: movement.quantity,
    reference: movement.reference,
    notes: movement.notes,
    createdAt: movement.createdAt.toISOString(),
  };
}

/** Maps a repository {@link StockLevelView} to its projection with low-stock flag. */
export function toStockLevelOutput(view: StockLevelView): StockLevelOutput {
  return {
    productId: view.stock.productId,
    branchId: view.stock.branchId,
    quantity: view.stock.quantity,
    productName: view.productName,
    minStock: view.minStock,
    lowStock: view.stock.isLow(view.minStock),
  };
}

/** Maps a repository {@link PaginatedResult} of movements to a projected page. */
export function toPagedStockMovementOutput(
  result: PaginatedResult<StockMovement>,
): PagedResult<StockMovementOutput> {
  return {
    items: result.items.map(toStockMovementOutput),
    meta: {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    },
  };
}

/** Maps a repository {@link CursorPage} of movements to a projected cursor page. */
export function toCursorPagedStockMovementOutput(
  page: CursorPage<StockMovement>,
): CursorPagedResult<StockMovementOutput> {
  return {
    items: page.items.map(toStockMovementOutput),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

/** Maps a repository {@link PaginatedResult} of stock levels to a projected page. */
export function toPagedStockLevelOutput(
  result: PaginatedResult<StockLevelView>,
): PagedResult<StockLevelOutput> {
  return {
    items: result.items.map(toStockLevelOutput),
    meta: {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    },
  };
}
