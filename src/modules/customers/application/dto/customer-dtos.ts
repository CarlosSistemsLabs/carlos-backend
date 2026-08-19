import { PAGINATION } from '@shared/constants/index.js';
import type { Nullable, PaginatedResult, SortDirection, UUID } from '@shared/types/index.js';
import type { Customer } from '../../domain/entities/customer.js';
import type { CustomerSortField } from '../../domain/repositories/customer-repository.js';

/** Input for {@link CreateCustomerUseCase}. */
export interface CreateCustomerInputDto {
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
 * Input for {@link UpdateCustomerUseCase}. Every mutable field is optional; only
 * provided fields are changed. Use `null` to clear an optional field
 * (`email`, `phone`, `taxId`, `address`, `notes`).
 */
export interface UpdateCustomerInputDto {
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

/** Input for {@link DeleteCustomerUseCase}. */
export interface DeleteCustomerInputDto {
  id: UUID;
  tenantId: UUID;
}

/** Input for {@link GetCustomerUseCase}. */
export interface GetCustomerInputDto {
  id: UUID;
  tenantId: UUID;
}

/** Input for {@link ListCustomersUseCase}. */
export interface ListCustomersInputDto {
  tenantId: UUID;
  page?: number;
  pageSize?: number;
  isActive?: boolean;
  sortBy?: CustomerSortField;
  sortDirection?: SortDirection;
}

/** Input for {@link SearchCustomersUseCase}. */
export interface SearchCustomersInputDto {
  tenantId: UUID;
  /** Free-text term matched (case-insensitive) across name/email/phone/taxId. */
  term: string;
  page?: number;
  pageSize?: number;
  isActive?: boolean;
}

/** Public projection of a customer. Value objects are flattened to strings. */
export interface CustomerOutput {
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

/** Maps a {@link Customer} aggregate to its public projection. */
export function toCustomerOutput(customer: Customer): CustomerOutput {
  return {
    id: customer.id,
    tenantId: customer.tenantId,
    name: customer.name,
    email: customer.email === null ? null : customer.email.value,
    phone: customer.phone === null ? null : customer.phone.value,
    taxId: customer.taxId === null ? null : customer.taxId.value,
    address: customer.address,
    notes: customer.notes,
    isActive: customer.isActive,
  };
}

/** Maps a repository {@link PaginatedResult} of customers to a projected page. */
export function toPagedCustomerOutput(
  result: PaginatedResult<Customer>,
): PagedResult<CustomerOutput> {
  return {
    items: result.items.map(toCustomerOutput),
    meta: {
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    },
  };
}
