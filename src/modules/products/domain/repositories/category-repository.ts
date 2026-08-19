import type { UUID } from '@shared/types/index.js';
import type { Category } from '../entities/category.js';

/**
 * Persistence abstraction for {@link Category} aggregates.
 *
 * Categories are tenant-scoped and hierarchical. {@link findChildren} supports
 * the tree-walking needed by the category-management use cases (task 13.4). The
 * concrete implementation lives in the infrastructure layer; the domain depends
 * only on this port (Clean Architecture, Requirement 3.2).
 */
export interface ICategoryRepository {
  /** Finds a category by id (excluding soft-deleted), or `null`. */
  findById(id: UUID): Promise<Category | null>;

  /** Returns all (non-deleted) categories for a tenant. */
  findByTenant(tenantId: UUID): Promise<Category[]>;

  /** Returns the direct children of a category (or roots when `parentId` is `null`). */
  findChildren(tenantId: UUID, parentId: UUID | null): Promise<Category[]>;

  /** Persists a new category. */
  create(category: Category): Promise<Category>;

  /** Persists changes to an existing category. */
  update(category: Category): Promise<Category>;

  /** Soft-deletes a category by stamping `deletedAt` (Requirement 9.4). */
  softDelete(id: UUID): Promise<void>;
}
