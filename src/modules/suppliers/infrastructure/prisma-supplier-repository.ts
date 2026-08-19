import type { PaginatedResult, UUID } from '@shared/types/index.js';
import { Supplier } from '../domain/entities/supplier.js';
import { Email } from '../domain/value-objects/email.js';
import { Phone } from '../domain/value-objects/phone.js';
import { TaxId } from '../domain/value-objects/tax-id.js';
import type {
  ISupplierRepository,
  SupplierFilters,
  SupplierQuery,
  SupplierSort,
} from '../domain/repositories/supplier-repository.js';

/**
 * Persistence row shape for the `Supplier` model. A structural subset of the
 * generated Prisma type so the value-object ⇄ column mapping stays explicit and
 * the repository remains trivially testable with a fake delegate.
 */
export interface SupplierRow {
  id: string;
  tenantId: string;
  name: string;
  email: string | null;
  phone: string | null;
  taxId: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
}

/** Arguments accepted by the `supplier` delegate's read/write methods. */
export interface SupplierFindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  skip?: number;
  take?: number;
}

/** Minimal `supplier` delegate surface used by {@link PrismaSupplierRepository}. */
export interface SupplierModelDelegate {
  findFirst(args: SupplierFindArgs): Promise<SupplierRow | null>;
  findMany(args: SupplierFindArgs): Promise<SupplierRow[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<SupplierRow>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<SupplierRow>;
}

/** A Prisma-like client exposing (at least) the `supplier` delegate. */
export interface SupplierPrismaClient {
  supplier: SupplierModelDelegate;
}

/** Default ordering applied when a query omits an explicit sort. */
const DEFAULT_SORT: SupplierSort = { field: 'name', direction: 'asc' };

/**
 * Prisma-backed {@link ISupplierRepository}.
 *
 * **Client choice:** bound (in the composition root) to the tenant-aware
 * `tenantPrisma` client, which auto-injects the active tenant on every query.
 * Methods still receive `tenantId` explicitly and apply it to the `where`
 * clause for defence-in-depth and so the repository behaves correctly even when
 * invoked outside a request context (Requirement 1.5).
 *
 * Soft-deleted rows (`deletedAt != null`) are excluded from every read
 * (Requirement 9.4); search uses a case-insensitive `contains` match across the
 * supplier's name, email, phone and tax id. Contact detail lookups normalise
 * their argument through the matching value object so a query matches the stored
 * canonical form.
 */
export class PrismaSupplierRepository implements ISupplierRepository {
  constructor(private readonly prisma: SupplierPrismaClient) {}

  async findById(id: UUID): Promise<Supplier | null> {
    const row = await this.prisma.supplier.findFirst({
      where: { id, deletedAt: null },
    });
    return row === null ? null : PrismaSupplierRepository.toDomain(row);
  }

  async findByEmail(tenantId: UUID, email: string): Promise<Supplier | null> {
    const row = await this.prisma.supplier.findFirst({
      where: { tenantId, email: Email.create(email).value, deletedAt: null },
    });
    return row === null ? null : PrismaSupplierRepository.toDomain(row);
  }

  async findByPhone(tenantId: UUID, phone: string): Promise<Supplier | null> {
    const row = await this.prisma.supplier.findFirst({
      where: { tenantId, phone: Phone.create(phone).value, deletedAt: null },
    });
    return row === null ? null : PrismaSupplierRepository.toDomain(row);
  }

  async findMany(tenantId: UUID, query: SupplierQuery): Promise<PaginatedResult<Supplier>> {
    const where = this.buildWhere(tenantId, query.filters);
    const sort = query.sort ?? DEFAULT_SORT;
    const skip = (query.page - 1) * query.pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { [sort.field]: sort.direction },
        skip,
        take: query.pageSize,
      }),
      this.prisma.supplier.count({ where }),
    ]);

    return {
      items: rows.map((row) => PrismaSupplierRepository.toDomain(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }

  async create(supplier: Supplier): Promise<Supplier> {
    const row = await this.prisma.supplier.create({
      data: { id: supplier.id, ...PrismaSupplierRepository.toPersistence(supplier) },
    });
    return PrismaSupplierRepository.toDomain(row);
  }

  async update(supplier: Supplier): Promise<Supplier> {
    const row = await this.prisma.supplier.update({
      where: { id: supplier.id },
      data: PrismaSupplierRepository.toPersistence(supplier),
    });
    return PrismaSupplierRepository.toDomain(row);
  }

  async softDelete(id: UUID): Promise<void> {
    await this.prisma.supplier.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async existsByEmail(tenantId: UUID, email: string, excludeId?: UUID): Promise<boolean> {
    const where: Record<string, unknown> = {
      tenantId,
      email: Email.create(email).value,
      deletedAt: null,
    };
    if (excludeId !== undefined) {
      where.id = { not: excludeId };
    }
    const count = await this.prisma.supplier.count({ where });
    return count > 0;
  }

  async existsByPhone(tenantId: UUID, phone: string, excludeId?: UUID): Promise<boolean> {
    const where: Record<string, unknown> = {
      tenantId,
      phone: Phone.create(phone).value,
      deletedAt: null,
    };
    if (excludeId !== undefined) {
      where.id = { not: excludeId };
    }
    const count = await this.prisma.supplier.count({ where });
    return count > 0;
  }

  /** Builds the `where` clause: tenant scope, soft-delete filter and filters. */
  private buildWhere(
    tenantId: UUID,
    filters: SupplierFilters | undefined,
  ): Record<string, unknown> {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (filters === undefined) {
      return where;
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    if (filters.search !== undefined && filters.search.length > 0) {
      // Case-insensitive substring match across name, email, phone and tax id.
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { phone: { contains: filters.search, mode: 'insensitive' } },
        { taxId: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  /** Maps a persistence row to the {@link Supplier} aggregate. */
  private static toDomain(row: SupplierRow): Supplier {
    return Supplier.reconstitute(row.id, {
      tenantId: row.tenantId,
      name: row.name,
      email: row.email === null ? null : Email.create(row.email),
      phone: row.phone === null ? null : Phone.create(row.phone),
      taxId: row.taxId === null ? null : TaxId.create(row.taxId),
      address: row.address,
      notes: row.notes,
      isActive: row.isActive,
    });
  }

  /** Maps a {@link Supplier} aggregate to a persistence payload. */
  private static toPersistence(supplier: Supplier): Record<string, unknown> {
    return {
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
}
