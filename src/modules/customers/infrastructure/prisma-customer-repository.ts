import type { PaginatedResult, UUID } from '@shared/types/index.js';
import { Customer } from '../domain/entities/customer.js';
import { Email } from '../domain/value-objects/email.js';
import { Phone } from '../domain/value-objects/phone.js';
import { TaxId } from '../domain/value-objects/tax-id.js';
import type {
  ICustomerRepository,
  CustomerFilters,
  CustomerQuery,
  CustomerSort,
} from '../domain/repositories/customer-repository.js';

/**
 * Persistence row shape for the `Customer` model. A structural subset of the
 * generated Prisma type so the value-object ⇄ column mapping stays explicit and
 * the repository remains trivially testable with a fake delegate.
 */
export interface CustomerRow {
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

/** Arguments accepted by the `customer` delegate's read/write methods. */
export interface CustomerFindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, unknown> | Record<string, unknown>[];
  skip?: number;
  take?: number;
}

/** Minimal `customer` delegate surface used by {@link PrismaCustomerRepository}. */
export interface CustomerModelDelegate {
  findFirst(args: CustomerFindArgs): Promise<CustomerRow | null>;
  findMany(args: CustomerFindArgs): Promise<CustomerRow[]>;
  count(args: { where?: Record<string, unknown> }): Promise<number>;
  create(args: { data: Record<string, unknown> }): Promise<CustomerRow>;
  update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<CustomerRow>;
}

/** A Prisma-like client exposing (at least) the `customer` delegate. */
export interface CustomerPrismaClient {
  customer: CustomerModelDelegate;
}

/** Default ordering applied when a query omits an explicit sort. */
const DEFAULT_SORT: CustomerSort = { field: 'name', direction: 'asc' };

/**
 * Prisma-backed {@link ICustomerRepository}.
 *
 * **Client choice:** bound (in the composition root) to the tenant-aware
 * `tenantPrisma` client, which auto-injects the active tenant on every query.
 * Methods still receive `tenantId` explicitly and apply it to the `where`
 * clause for defence-in-depth and so the repository behaves correctly even when
 * invoked outside a request context (Requirement 1.5).
 *
 * Soft-deleted rows (`deletedAt != null`) are excluded from every read
 * (Requirement 9.4); search uses a case-insensitive `contains` match across the
 * customer's name, email, phone and tax id. Contact detail lookups normalise
 * their argument through the matching value object so a query matches the stored
 * canonical form.
 */
export class PrismaCustomerRepository implements ICustomerRepository {
  constructor(private readonly prisma: CustomerPrismaClient) {}

  async findById(id: UUID): Promise<Customer | null> {
    const row = await this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
    });
    return row === null ? null : PrismaCustomerRepository.toDomain(row);
  }

  async findByEmail(tenantId: UUID, email: string): Promise<Customer | null> {
    const row = await this.prisma.customer.findFirst({
      where: { tenantId, email: Email.create(email).value, deletedAt: null },
    });
    return row === null ? null : PrismaCustomerRepository.toDomain(row);
  }

  async findByPhone(tenantId: UUID, phone: string): Promise<Customer | null> {
    const row = await this.prisma.customer.findFirst({
      where: { tenantId, phone: Phone.create(phone).value, deletedAt: null },
    });
    return row === null ? null : PrismaCustomerRepository.toDomain(row);
  }

  async findMany(tenantId: UUID, query: CustomerQuery): Promise<PaginatedResult<Customer>> {
    const where = this.buildWhere(tenantId, query.filters);
    const sort = query.sort ?? DEFAULT_SORT;
    const skip = (query.page - 1) * query.pageSize;

    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { [sort.field]: sort.direction },
        skip,
        take: query.pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      items: rows.map((row) => PrismaCustomerRepository.toDomain(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.pageSize),
    };
  }

  async create(customer: Customer): Promise<Customer> {
    const row = await this.prisma.customer.create({
      data: { id: customer.id, ...PrismaCustomerRepository.toPersistence(customer) },
    });
    return PrismaCustomerRepository.toDomain(row);
  }

  async update(customer: Customer): Promise<Customer> {
    const row = await this.prisma.customer.update({
      where: { id: customer.id },
      data: PrismaCustomerRepository.toPersistence(customer),
    });
    return PrismaCustomerRepository.toDomain(row);
  }

  async softDelete(id: UUID): Promise<void> {
    await this.prisma.customer.update({
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
    const count = await this.prisma.customer.count({ where });
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
    const count = await this.prisma.customer.count({ where });
    return count > 0;
  }

  /** Builds the `where` clause: tenant scope, soft-delete filter and filters. */
  private buildWhere(
    tenantId: UUID,
    filters: CustomerFilters | undefined,
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

  /** Maps a persistence row to the {@link Customer} aggregate. */
  private static toDomain(row: CustomerRow): Customer {
    return Customer.reconstitute(row.id, {
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

  /** Maps a {@link Customer} aggregate to a persistence payload. */
  private static toPersistence(customer: Customer): Record<string, unknown> {
    return {
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
}
