import { AggregateRoot } from '@domain/entities/aggregate-root.js';
import { ValidationError } from '@domain/errors/index.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import { SelfParentCategoryError } from '../errors/product-errors.js';

/** Attributes describing a product category. */
export interface CategoryProps {
  tenantId: UUID;
  name: string;
  description: Nullable<string>;
  /** Parent category id for hierarchical nesting, or `null` for a root. */
  parentId: Nullable<UUID>;
}

/** Input accepted by {@link Category.create} when defining a new category. */
export interface CreateCategoryInput {
  tenantId: UUID;
  name: string;
  description?: Nullable<string>;
  parentId?: Nullable<UUID>;
}

/**
 * Category aggregate root (Requirement 9.1).
 *
 * Categories form a tenant-scoped hierarchy: each may reference a parent
 * category, enabling arbitrary nesting. The entity guards against the immediate
 * self-reference it can observe (a category being its own parent).
 *
 * **Cycle-detection limitation:** preventing deeper cycles (A → B → A) requires
 * walking the ancestor chain, which spans multiple aggregates and belongs to
 * the category-management use case (task 13.4). The entity cannot enforce that
 * in isolation and intentionally does not try.
 */
export class Category extends AggregateRoot<CategoryProps> {
  private constructor(props: CategoryProps, id?: UUID) {
    super(props, id);
  }

  /**
   * Defines a brand new category.
   *
   * @throws {ValidationError} when the name is empty.
   * @throws {SelfParentCategoryError} when `parentId` equals the new id.
   */
  static create(input: CreateCategoryInput, id?: UUID): Category {
    const name = Category.assertName(input.name);
    const category = new Category(
      {
        tenantId: input.tenantId,
        name,
        description: input.description ?? null,
        parentId: input.parentId ?? null,
      },
      id,
    );
    if (category.props.parentId !== null && category.props.parentId === category.id) {
      throw new SelfParentCategoryError(category.id);
    }
    return category;
  }

  /** Rehydrates a {@link Category} from persisted state. */
  static reconstitute(id: UUID, props: CategoryProps): Category {
    return new Category({ ...props }, id);
  }

  get tenantId(): UUID {
    return this.props.tenantId;
  }

  get name(): string {
    return this.props.name;
  }

  get description(): Nullable<string> {
    return this.props.description;
  }

  get parentId(): Nullable<UUID> {
    return this.props.parentId;
  }

  /** Returns `true` when this category has no parent (a tree root). */
  isRoot(): boolean {
    return this.props.parentId === null;
  }

  /**
   * Renames the category and optionally updates its description.
   *
   * @throws {ValidationError} when the new name is empty.
   */
  rename(name: string, description?: Nullable<string>): void {
    this.props.name = Category.assertName(name);
    if (description !== undefined) {
      this.props.description = description;
    }
  }

  /**
   * Sets (or clears, with `null`) the parent category.
   *
   * @throws {SelfParentCategoryError} when `parentId` equals this category's id.
   */
  setParent(parentId: Nullable<UUID>): void {
    if (parentId !== null && parentId === this.id) {
      throw new SelfParentCategoryError(this.id);
    }
    this.props.parentId = parentId;
  }

  private static assertName(name: string): string {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new ValidationError('Category name is required', { name });
    }
    return name.trim();
  }
}
