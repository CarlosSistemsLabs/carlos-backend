/**
 * Shared domain types used across all layers and modules.
 *
 * These are framework-agnostic primitives so they can be safely imported by the
 * domain layer without introducing external dependencies (Clean Architecture,
 * Requirement 3.2).
 */

/** A value that may explicitly be `null`. */
export type Nullable<T> = T | null;

/** A value that may be `undefined`. */
export type Optional<T> = T | undefined;

/** A value that may be `null` or `undefined`. */
export type Maybe<T> = T | null | undefined;

/** JavaScript primitive types. */
export type Primitive = string | number | boolean | bigint | symbol | null | undefined;

/** A universally unique identifier represented as a string. */
export type UUID = string;

/** An ISO-8601 formatted date string. */
export type ISODateString = string;

/** A Unix epoch timestamp in milliseconds. */
export type Timestamp = number;

/** Standard creation/modification audit timestamps. */
export interface Timestamps {
  createdAt: Date;
  updatedAt: Date;
}

/** Soft-delete marker (Requirement 9.4). */
export interface SoftDeletable {
  deletedAt: Nullable<Date>;
}

/** Marks an entity as belonging to a single tenant (Requirement 9.2). */
export interface TenantScoped {
  tenantId: UUID;
}

/** Direction used when sorting query results. */
export type SortDirection = 'asc' | 'desc';

/** Pagination request parameters. */
export interface PaginationParams {
  page: number;
  pageSize: number;
}

/** A page of results plus the metadata required to navigate further. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
