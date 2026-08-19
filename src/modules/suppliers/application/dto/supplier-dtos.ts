import { PAGINATION } from '@shared/constants/index.js';
import type { Nullable, PaginatedResult, SortDirection, UUID } from '@shared/types/index.js';
import type { Supplier } from '../../domain/entities/supplier.js';
import type { SupplierSortField } from '../../domain/repositories/supplier-repository.js';

/** Input for {@link CreateSupplierUseCase}. */
export interface CreateSupplierInputDto {
  tenantId: UUID;
  name: string;
  email?: Nullable<string>;
  phone?: Nullable<string>;
  taxId?: Nullable<string>;
  address?: Nullable<string>;
  notes?: Nullable<string>;
  isActive?: boolean;
}

/**
 * Input for {@link UpdateSupplierUseCase}. Every mutable field is optional; only
 * provided fields are changed. Use `null` to clear an optional field
 * (`email`, `phone`, `taxId`, `address`, `notes`).
 */
export interface UpdateSupplierInputDto {
  id: UUID;
  tenantId: UUID;
  name?: string;
  email?: Nullable<string>;
  phone?: Nullable<string>;
  taxId?: Nullable<string>;
  address?: Nullable<string>;
  notes?: Nullable<string>;
  isActive?: boolean;
}

/** Input for {@link DeleteSupplierUseCase}. */
export interface DeleteSupplierInputDto {
  id: UUID;
  tenantId: UUID;
}

/** Input for {@link GetSupplierUseCase}. */
export interface GetSupplierInputDto {
  id: UUID;
  tenantId: UUID;
}

/** Input for {@link ListSuppliersUseCase}. */
export interface ListSuppliersInputDto {
  tenantId: UUID;
  page?: number;
  pageSize?: number;
  isActive?: boolean;
  sortBy?: SupplierSortField;
  sortDirection?: SortDirection;
}

/** Input for {@link SearchSuppliersUseCase}. */
export interface SearchSuppliersInputDto {
  tenantId: UUID;
  /** Free-text term matched (case-insensitive) across name/email/phone/taxId. */
  term: string;
  page?: number;
  pageSize?: number;
  isActive?: boolean;
}

/** Public projection of a supplier. Value objects are flattened to strings. */
export interface SupplierOutput {
  id: UUID;
  tenantId: UUID;
  name: string;
  email: Nullable<string>;
  phone: Nullable<string>;
  taxId: Nullable<string>;
  address: Nullable<string>;
  notes: Nullable<string>;
  isActive: boolean;
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

/** Maps a {@link Supplier} aggregate to its public projection. */
export function toSupplierOutput(supplier: Supplier): SupplierOutput {
  return {
    id: supplier.id,
    tenantId: supplier.tenantId,
    name: supplier.name,
    email: supplier.email === null ? null : supplier.email.value,
    phone: supplier.phone === null ? null : supplier.phone.value,
    taxId: supplier.taxId === null ? null : supplier.taxId.value,
    address: supplier.address,
    notes: supplier.notes,
    isActive: supplier.isActive,
  };
}

/** Maps a repository {@link PaginatedResult} of suppliers to a projected page. */
export function toPagedSupplierOutput(
  result: PaginatedResult<Supplier>,
): PagedResult<SupplierOutput> {
  return {
    items: result.items.map(toSupplierOutput),
    meta: {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    },
  };
}
