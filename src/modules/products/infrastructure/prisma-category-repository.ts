import type { UUID } from '@shared/types/index.js';
import { Category } from '../domain/entities/category.js';
import type { ICategoryRepository } from '../domain/repositories/category-repository.js';

/**
 * Persistence row shape for the `Category` model. A structural subset of the
 * generated Prisma type so the mapper stays explicit and the repository remains
 * trivially testable with a fake delegate.
 */
export interface CategoryRow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  parentId: string | null;
}

/** Arguments accepted by the `category` delegate's methods. */
export interface CategoryFindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
}

/** Minimal `category` delegate surface used by {@link PrismaCategoryRepository}. */
export interface CategoryModelDelegate {
  findFirst(args: CategoryFindArgs): Promise<CategoryRow | null>;
  findMany(args: CategoryFindArgs): Promise<CategoryRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<CategoryRow>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<CategoryRow>;
}

/** A Prisma-like client exposing (at least) the `category` delegate. */
export interface CategoryPrismaClient {
  category: CategoryModelDelegate;
}

/**
 * Prisma-backed {@link ICategoryRepository}.
 *
 * Bound (in the composition root) to the tenant-aware `tenantPrisma` client.
 * This is a lean implementation covering what the product use cases need today
 * (notably {@link findById} for the create/update category-existence check);
 * full category management lands with the category-management task. Soft-deleted
 * rows are excluded from every read (Requirement 9.4).
 */
export class PrismaCategoryRepository implements ICategoryRepository {
  constructor(private readonly prisma: CategoryPrismaClient) {}

  async findById(id: UUID): Promise<Category | null> {
    const row = await this.prisma.category.findFirst({
      where: { id, deletedAt: null },
    });
    return row === null ? null : PrismaCategoryRepository.toDomain(row);
  }

  async findByTenant(tenantId: UUID): Promise<Category[]> {
    const rows = await this.prisma.category.findMany({
      where: { tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => PrismaCategoryRepository.toDomain(row));
  }

  async findChildren(tenantId: UUID, parentId: UUID | null): Promise<Category[]> {
    const rows = await this.prisma.category.findMany({
      where: { tenantId, parentId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => PrismaCategoryRepository.toDomain(row));
  }

  async create(category: Category): Promise<Category> {
    const row = await this.prisma.category.create({
      data: { id: category.id, ...PrismaCategoryRepository.toPersistence(category) },
    });
    return PrismaCategoryRepository.toDomain(row);
  }

  async update(category: Category): Promise<Category> {
    const row = await this.prisma.category.update({
      where: { id: category.id },
      data: PrismaCategoryRepository.toPersistence(category),
    });
    return PrismaCategoryRepository.toDomain(row);
  }

  async softDelete(id: UUID): Promise<void> {
    await this.prisma.category.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Maps a persistence row to the {@link Category} aggregate. */
  private static toDomain(row: CategoryRow): Category {
    return Category.reconstitute(row.id, {
      tenantId: row.tenantId,
      name: row.name,
      description: row.description,
      parentId: row.parentId,
    });
  }

  /** Maps a {@link Category} aggregate to a persistence payload. */
  private static toPersistence(category: Category): Record<string, unknown> {
    return {
      tenantId: category.tenantId,
      name: category.name,
      description: category.description,
      parentId: category.parentId,
    };
  }
}
