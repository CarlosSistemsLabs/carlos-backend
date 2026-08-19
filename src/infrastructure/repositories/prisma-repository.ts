import { PAGINATION } from '@shared/constants/index.js';
import type { PaginatedResult } from '@shared/types/index.js';
import type {
  FindByIdOptions,
  FindManyOptions,
  IRepository,
  QueryFilter,
} from '@domain/repositories/index.js';

/**
 * Arguments accepted by the Prisma query methods the base repository relies on.
 *
 * This is a deliberately small structural subset of the generated Prisma
 * delegate types. Keeping it minimal lets the base class stay model-agnostic
 * and makes it trivial to substitute a test double for the delegate.
 */
export interface PrismaQueryArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  skip?: number;
  take?: number;
}

/** The subset of a Prisma model delegate consumed by {@link PrismaRepository}. */
export interface PrismaModelDelegate<TModel> {
  findFirst(args: PrismaQueryArgs): Promise<TModel | null>;
  findMany(args: PrismaQueryArgs): Promise<TModel[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<TModel>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<TModel>;
  delete(args: { where: Record<string, unknown> }): Promise<TModel>;
}

/** Configuration controlling base repository behaviour. */
export interface PrismaRepositoryConfig {
  /**
   * Whether the underlying model supports soft deletes via a `deletedAt`
   * column. When `true`, reads exclude rows where `deletedAt` is set and
   * {@link PrismaRepository.softDelete} stamps the column instead of removing
   * the row (Requirement 9.4). Defaults to `true`.
   */
  softDelete?: boolean;
  /** Name of the soft-delete timestamp column. Defaults to `deletedAt`. */
  deletedAtField?: string;
  /** Name of the identity column. Defaults to `id`. */
  idField?: string;
  /** Default sort field applied when a query omits an explicit sort. */
  defaultSortField?: string;
}

const DEFAULT_DELETED_AT_FIELD = 'deletedAt';
const DEFAULT_ID_FIELD = 'id';

/**
 * Reusable Prisma-backed implementation of {@link IRepository}.
 *
 * Concrete repositories extend this class, supply the Prisma model delegate,
 * and implement the {@link PrismaRepository.toDomain} /
 * {@link PrismaRepository.toPersistence} mappers. The base class centralises
 * cross-cutting persistence concerns — pagination, soft-delete filtering, and
 * mapping between persistence records and domain entities — so individual
 * repositories stay thin (Clean Architecture, Requirement 3.2).
 *
 * @typeParam TEntity - The domain entity type.
 * @typeParam TModel - The Prisma model (row) type.
 * @typeParam TId - The identifier type.
 */
export abstract class PrismaRepository<TEntity, TModel, TId = string>
  implements IRepository<TEntity, TId>
{
  protected readonly softDeleteEnabled: boolean;
  protected readonly deletedAtField: string;
  protected readonly idField: string;
  protected readonly defaultSortField: string | undefined;

  protected constructor(
    protected readonly model: PrismaModelDelegate<TModel>,
    config: PrismaRepositoryConfig = {},
  ) {
    this.softDeleteEnabled = config.softDelete ?? true;
    this.deletedAtField = config.deletedAtField ?? DEFAULT_DELETED_AT_FIELD;
    this.idField = config.idField ?? DEFAULT_ID_FIELD;
    this.defaultSortField = config.defaultSortField;
  }

  /** Maps a persistence record to its domain representation. */
  protected abstract toDomain(model: TModel): TEntity;

  /** Maps a domain entity to a persistence payload for create/update. */
  protected abstract toPersistence(entity: TEntity): Record<string, unknown>;

  public async findById(id: TId, options: FindByIdOptions = {}): Promise<TEntity | null> {
    const where = this.applySoftDeleteFilter({ [this.idField]: id }, options.includeDeleted);
    const record = await this.model.findFirst({ where });
    return record === null ? null : this.toDomain(record);
  }

  public async findMany(options: FindManyOptions = {}): Promise<PaginatedResult<TEntity>> {
    const page = this.normalisePage(options.page);
    const pageSize = this.normalisePageSize(options.pageSize);
    const where = this.applySoftDeleteFilter(
      { ...(options.filter ?? {}) },
      options.includeDeleted,
    );

    const findArgs: PrismaQueryArgs = {
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
    };
    const orderBy = this.resolveOrderBy(options.sort);
    if (orderBy !== undefined) {
      findArgs.orderBy = orderBy;
    }

    const [records, total] = await Promise.all([
      this.model.findMany(findArgs),
      this.model.count({ where }),
    ]);

    return {
      items: records.map((record) => this.toDomain(record)),
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  public async create(entity: TEntity): Promise<TEntity> {
    const record = await this.model.create({ data: this.toPersistence(entity) });
    return this.toDomain(record);
  }

  public async update(id: TId, changes: Partial<TEntity>): Promise<TEntity> {
    const record = await this.model.update({
      where: { [this.idField]: id },
      data: this.toPersistencePartial(changes),
    });
    return this.toDomain(record);
  }

  public async softDelete(id: TId): Promise<void> {
    if (!this.softDeleteEnabled) {
      await this.delete(id);
      return;
    }
    await this.model.update({
      where: { [this.idField]: id },
      data: { [this.deletedAtField]: new Date() },
    });
  }

  public async delete(id: TId): Promise<void> {
    await this.model.delete({ where: { [this.idField]: id } });
  }

  public async exists(id: TId): Promise<boolean> {
    const where = this.applySoftDeleteFilter({ [this.idField]: id }, false);
    const count = await this.model.count({ where });
    return count > 0;
  }

  public async count(filter: QueryFilter = {}): Promise<number> {
    const where = this.applySoftDeleteFilter({ ...filter }, false);
    return this.model.count({ where });
  }

  /**
   * Maps a partial domain entity to a persistence payload. The default
   * implementation reuses {@link toPersistence} when the changeset is a full
   * entity; subclasses with non-trivial partial updates can override this.
   */
  protected toPersistencePartial(changes: Partial<TEntity>): Record<string, unknown> {
    return { ...(changes as Record<string, unknown>) };
  }

  /** Adds the `deletedAt IS NULL` constraint unless deleted rows are requested. */
  private applySoftDeleteFilter(
    where: Record<string, unknown>,
    includeDeleted: boolean | undefined,
  ): Record<string, unknown> {
    if (!this.softDeleteEnabled || includeDeleted === true) {
      return where;
    }
    return { ...where, [this.deletedAtField]: null };
  }

  private resolveOrderBy(
    sort: FindManyOptions['sort'],
  ): Record<string, unknown> | undefined {
    if (sort !== undefined) {
      return { [sort.field]: sort.direction };
    }
    if (this.defaultSortField !== undefined) {
      return { [this.defaultSortField]: 'asc' };
    }
    return undefined;
  }

  private normalisePage(page: number | undefined): number {
    if (page === undefined || !Number.isFinite(page) || page < PAGINATION.DEFAULT_PAGE) {
      return PAGINATION.DEFAULT_PAGE;
    }
    return Math.floor(page);
  }

  private normalisePageSize(pageSize: number | undefined): number {
    if (pageSize === undefined || !Number.isFinite(pageSize)) {
      return PAGINATION.DEFAULT_PAGE_SIZE;
    }
    const floored = Math.floor(pageSize);
    if (floored < PAGINATION.MIN_PAGE_SIZE) {
      return PAGINATION.MIN_PAGE_SIZE;
    }
    if (floored > PAGINATION.MAX_PAGE_SIZE) {
      return PAGINATION.MAX_PAGE_SIZE;
    }
    return floored;
  }
}
