import type { Nullable, UUID } from '@shared/types/index.js';
import type { Category } from '../../domain/entities/category.js';

/**
 * DTOs and mappers for the category-management use cases (task 13.4).
 *
 * Categories are a tenant-scoped hierarchy. The `tenantId` is never accepted
 * from a client DTO field — it is always derived from the authenticated JWT in
 * the presentation layer and threaded through these inputs so a caller can
 * never act across tenant boundaries (Requirement 1.5).
 */

/** Input for {@link CreateCategoryUseCase}. */
export interface CreateCategoryInputDto {
  tenantId: UUID;
  name: string;
  description?: Nullable<string>;
  /** Parent category id for nesting, or `null`/omitted for a root category. */
  parentId?: Nullable<UUID>;
}

/**
 * Input for {@link UpdateCategoryUseCase}. Every mutable field is optional; only
 * provided fields change. Pass `parentId: null` to detach the category (make it
 * a root); pass `description: null` to clear the description.
 */
export interface UpdateCategoryInputDto {
  id: UUID;
  tenantId: UUID;
  name?: string;
  description?: Nullable<string>;
  parentId?: Nullable<UUID>;
}

/** Input for {@link DeleteCategoryUseCase}. */
export interface DeleteCategoryInputDto {
  id: UUID;
  tenantId: UUID;
}

/** Input for {@link GetCategoryUseCase}. */
export interface GetCategoryInputDto {
  id: UUID;
  tenantId: UUID;
}

/** Input for {@link ListCategoriesUseCase}. */
export interface ListCategoriesInputDto {
  tenantId: UUID;
}

/** Input for {@link GetCategoryTreeUseCase}. */
export interface GetCategoryTreeInputDto {
  tenantId: UUID;
}

/** Flat public projection of a category. */
export interface CategoryOutput {
  id: UUID;
  tenantId: UUID;
  name: string;
  description: Nullable<string>;
  parentId: Nullable<UUID>;
}

/** A node in the hierarchical category tree (roots → nested children). */
export interface CategoryTreeNode {
  id: UUID;
  name: string;
  description: Nullable<string>;
  parentId: Nullable<UUID>;
  children: CategoryTreeNode[];
}

/** Maps a {@link Category} aggregate to its flat public projection. */
export function toCategoryOutput(category: Category): CategoryOutput {
  return {
    id: category.id,
    tenantId: category.tenantId,
    name: category.name,
    description: category.description,
    parentId: category.parentId,
  };
}

/**
 * Builds the hierarchical category tree from a flat list of categories in a
 * single pass (O(n)), avoiding the N+1 queries a recursive `findChildren`
 * traversal would incur.
 *
 * Roots are categories with no parent, OR whose `parentId` references a
 * category that is not present in the supplied set (e.g. a soft-deleted or
 * cross-tenant parent) — such "orphans" are surfaced as roots rather than
 * silently dropped. Children of each node preserve the input ordering (the
 * repository returns them sorted by name).
 */
export function buildCategoryTree(categories: Category[]): CategoryTreeNode[] {
  const nodesById = new Map<UUID, CategoryTreeNode>();
  for (const category of categories) {
    nodesById.set(category.id, {
      id: category.id,
      name: category.name,
      description: category.description,
      parentId: category.parentId,
      children: [],
    });
  }

  const roots: CategoryTreeNode[] = [];
  for (const category of categories) {
    const node = nodesById.get(category.id)!;
    const parentId = category.parentId;
    const parent = parentId === null ? undefined : nodesById.get(parentId);
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  return roots;
}
