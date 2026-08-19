import { PAGINATION } from '@shared/constants/index.js';
import { TENANT_DEFAULTS } from '@shared/constants/index.js';
import type {
  Nullable,
  PaginatedResult,
  SortDirection,
  UUID,
} from '@shared/types/index.js';
import type { Product } from '../../domain/entities/product.js';
import type { ProductSortField } from '../../domain/repositories/product-repository.js';

/**
 * Default ISO-4217 currency applied to product money amounts.
 *
 * The `Product` table persists `price`/`cost` as bare `Decimal` columns (no
 * currency column), so a currency must be supplied when rehydrating the
 * {@link Money} value object. Amounts are denominated in the tenant's base
 * currency; absent a per-request tenant currency this falls back to the
 * platform default (`ARS`, see {@link TENANT_DEFAULTS}). Callers that know the
 * tenant currency can override it on the input DTOs.
 */
export const DEFAULT_PRODUCT_CURRENCY = TENANT_DEFAULTS.CURRENCY;

/** Input for {@link CreateProductUseCase}. */
export interface CreateProductInputDto {
  tenantId: UUID;
  categoryId: UUID;
  sku: string;
  name: string;
  /** Selling price as a decimal string (e.g. `"19.90"`). Must be > 0. */
  price: string;
  description?: Nullable<string>;
  /** Unit cost as a decimal string, or `null`. Must be >= 0 when present. */
  cost?: Nullable<string>;
  /** Tax rate percentage in `[0, 100]`. Defaults to `0`. */
  taxRate?: number;
  unit?: string;
  minStock?: number;
  isActive?: boolean;
  imageUrl?: Nullable<string>;
  /** ISO currency for the money amounts. Defaults to {@link DEFAULT_PRODUCT_CURRENCY}. */
  currency?: string;
}

/**
 * Input for {@link UpdateProductUseCase}. Every mutable field is optional; only
 * provided fields are changed. Use `null` to clear nullable fields
 * (`description`, `cost`, `imageUrl`).
 */
export interface UpdateProductInputDto {
  id: UUID;
  tenantId: UUID;
  categoryId?: UUID;
  sku?: string;
  name?: string;
  price?: string;
  description?: Nullable<string>;
  cost?: Nullable<string>;
  taxRate?: number;
  unit?: string;
  minStock?: number;
  isActive?: boolean;
  imageUrl?: Nullable<string>;
  currency?: string;
}

/** Input for {@link DeleteProductUseCase}. */
export interface DeleteProductInputDto {
  id: UUID;
  tenantId: UUID;
}

/** Input for {@link GetProductUseCase}. */
export interface GetProductInputDto {
  id: UUID;
  tenantId: UUID;
}

/** Input for {@link ListProductsUseCase}. */
export interface ListProductsInputDto {
  tenantId: UUID;
  page?: number;
  pageSize?: number;
  categoryId?: UUID;
  isActive?: boolean;
  sortBy?: ProductSortField;
  sortDirection?: SortDirection;
  currency?: string;
}

/** Input for {@link SearchProductsUseCase}. */
export interface SearchProductsInputDto {
  tenantId: UUID;
  /** Free-text term matched (case-insensitive) against product name and SKU. */
  term: string;
  page?: number;
  pageSize?: number;
  categoryId?: UUID;
  isActive?: boolean;
  currency?: string;
}

/** Public projection of a product. Money is exposed as decimal strings. */
export interface ProductOutput {
  id: UUID;
  tenantId: UUID;
  categoryId: UUID;
  sku: string;
  name: string;
  description: Nullable<string>;
  /** Selling price as a decimal string (e.g. `"19.90"`). */
  price: string;
  /** Unit cost as a decimal string, or `null`. */
  cost: Nullable<string>;
  /** ISO currency of the money amounts. */
  currency: string;
  /** Tax rate percentage in `[0, 100]`. */
  taxRate: number;
  /** Selling price with tax applied, as a decimal string. */
  priceWithTax: string;
  unit: string;
  minStock: number;
  isActive: boolean;
  imageUrl: Nullable<string>;
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
 * values are coerced to the nearest valid value rather than rejected, so a
 * listing never fails purely because of an over-eager `pageSize`.
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

/** Maps a {@link Product} aggregate to its public projection. */
export function toProductOutput(product: Product): ProductOutput {
  return {
    id: product.id,
    tenantId: product.tenantId,
    categoryId: product.categoryId,
    sku: product.sku.value,
    name: product.name,
    description: product.description,
    price: product.price.toDecimalString(),
    cost: product.cost === null ? null : product.cost.toDecimalString(),
    currency: product.price.currency,
    taxRate: product.taxRate,
    priceWithTax: product.computePriceWithTax().toDecimalString(),
    unit: product.unit,
    minStock: product.minStock,
    isActive: product.isActive,
    imageUrl: product.imageUrl,
  };
}

/** Maps a repository {@link PaginatedResult} of products to a projected page. */
export function toPagedProductOutput(
  result: PaginatedResult<Product>,
): PagedResult<ProductOutput> {
  return {
    items: result.items.map(toProductOutput),
    meta: {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    },
  };
}
