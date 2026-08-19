import type {
  PaginatedResult,
  SortDirection,
  TenantScoped,
  UUID,
} from '@shared/types/index.js';

/**
 * Framework-agnostic query filter.
 *
 * A plain key/value map describing equality (or richer) constraints. The
 * concrete shape is interpreted by the infrastructure layer; the domain only
 * needs the ability to express "narrow results by these fields" without taking
 * a dependency on any ORM (Clean Architecture, Requirement 3.2).
 */
export type QueryFilter = Record<string, unknown>;

/** Sorting instruction for list queries. */
export interface SortOptions {
  /** The field/property name to sort by. */
  field: string;
  /** Ascending or descending order. */
  direction: SortDirection;
}

/**
 * Options accepted by {@link IRepository.findMany}.
 *
 * All members are optional; sensible defaults are applied by the
 * implementation (page 1, default page size, ascending creation order, and
 * soft-deleted rows excluded).
 */
export interface FindManyOptions {
  /** 1-based page number. */
  page?: number;
  /** Number of items per page. */
  pageSize?: number;
  /** Additional equality constraints to apply. */
  filter?: QueryFilter;
  /** Sort instruction. */
  sort?: SortOptions;
  /** When `true`, soft-deleted rows are included in the results. */
  includeDeleted?: boolean;
}

/** Options accepted by read operations that target a single row. */
export interface FindByIdOptions {
  /** When `true`, a soft-deleted row may be returned. */
  includeDeleted?: boolean;
}

/**
 * Generic persistence abstraction for an aggregate/entity.
 *
 * This interface lives in the domain layer and MUST remain free of any
 * infrastructure (Prisma, SQL, HTTP) types so that domain and application code
 * depend on abstractions rather than concretions (dependency inversion,
 * Requirement 3.2). Concrete implementations live in the infrastructure layer.
 *
 * @typeParam TEntity - The domain entity/aggregate type.
 * @typeParam TId - The identifier type (defaults to {@link UUID}).
 */
export interface IRepository<TEntity, TId = UUID> {
  /**
   * Returns the entity with the given identity, or `null` when it does not
   * exist (or has been soft-deleted and `includeDeleted` is not set).
   */
  findById(id: TId, options?: FindByIdOptions): Promise<TEntity | null>;

  /** Returns a single page of entities together with pagination metadata. */
  findMany(options?: FindManyOptions): Promise<PaginatedResult<TEntity>>;

  /** Persists a new entity and returns the stored representation. */
  create(entity: TEntity): Promise<TEntity>;

  /** Applies a partial update to an existing entity and returns the result. */
  update(id: TId, changes: Partial<TEntity>): Promise<TEntity>;

  /**
   * Soft-deletes the entity by stamping its `deletedAt` marker. Reads will
   * exclude it by default (Requirement 9.4).
   */
  softDelete(id: TId): Promise<void>;

  /** Permanently removes the entity. Use with care. */
  delete(id: TId): Promise<void>;

  /** Returns `true` when a (non-soft-deleted) entity with the id exists. */
  exists(id: TId): Promise<boolean>;

  /** Counts entities matching the optional filter (excluding soft-deleted). */
  count(filter?: QueryFilter): Promise<number>;
}

/**
 * A repository whose operations are scoped to a single tenant.
 *
 * Tenant-scoped repositories accept the {@link TenantScoped.tenantId} so that
 * row-level isolation can be enforced consistently across all queries
 * (Requirement 1.2).
 *
 * @typeParam TEntity - The tenant-scoped domain entity type.
 * @typeParam TId - The identifier type (defaults to {@link UUID}).
 */
export interface ITenantScopedRepository<TEntity extends TenantScoped, TId = UUID> {
  /** Returns the entity within the tenant, or `null` when absent. */
  findById(tenantId: UUID, id: TId, options?: FindByIdOptions): Promise<TEntity | null>;

  /** Returns a page of entities belonging to the tenant. */
  findMany(tenantId: UUID, options?: FindManyOptions): Promise<PaginatedResult<TEntity>>;

  /** Persists a new entity for the tenant. */
  create(entity: TEntity): Promise<TEntity>;

  /** Updates an entity owned by the tenant. */
  update(tenantId: UUID, id: TId, changes: Partial<TEntity>): Promise<TEntity>;

  /** Soft-deletes an entity owned by the tenant. */
  softDelete(tenantId: UUID, id: TId): Promise<void>;

  /** Permanently removes an entity owned by the tenant. */
  delete(tenantId: UUID, id: TId): Promise<void>;

  /** Returns `true` when the tenant owns a matching, live entity. */
  exists(tenantId: UUID, id: TId): Promise<boolean>;

  /** Counts the tenant's entities matching the optional filter. */
  count(tenantId: UUID, filter?: QueryFilter): Promise<number>;
}
