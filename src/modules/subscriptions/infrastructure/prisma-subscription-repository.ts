import type { Nullable, UUID } from '@shared/types/index.js';
import { Subscription } from '../domain/entities/subscription.js';
import type { ISubscriptionRepository } from '../domain/repositories/subscription-repository.js';
import { assertSubscriptionStatus } from '../domain/value-objects/subscription-status.js';

/** Persistence row for a `Subscription` (structural subset of Prisma's type). */
export interface SubscriptionRow {
  id: string;
  tenantId: string;
  planId: string;
  status: string;
  startDate: Date;
  endDate: Date | null;
  autoRenew: boolean;
}

/** Minimal `subscription` delegate surface used by the repository. */
export interface SubscriptionModelDelegate {
  findFirst(args: {
    where: Record<string, unknown>;
    orderBy?: Record<string, unknown> | Record<string, unknown>[];
  }): Promise<SubscriptionRow | null>;
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown> | Record<string, unknown>[];
  }): Promise<SubscriptionRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<SubscriptionRow>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<SubscriptionRow>;
}

/** A Prisma-like client exposing the `subscription` delegate. */
export interface SubscriptionPrismaClient {
  subscription: SubscriptionModelDelegate;
}

/** Subscriptions are listed newest-first (by `startDate`) by default. */
const DEFAULT_ORDER_BY = { startDate: 'desc' } as const;

/**
 * Prisma-backed {@link ISubscriptionRepository}.
 *
 * **Client choice:** bound (in the composition root) to the tenant-aware
 * `tenantPrisma` client, which auto-injects the active tenant into every query;
 * the repository also applies `tenantId` explicitly for defence-in-depth
 * (Requirement 1.5). {@link findActiveByTenant} orders by `startDate desc` so
 * the newest active subscription wins when more than one exists, matching the
 * feature-access read path.
 */
export class PrismaSubscriptionRepository implements ISubscriptionRepository {
  constructor(private readonly prisma: SubscriptionPrismaClient) {}

  async findById(tenantId: UUID, id: UUID): Promise<Subscription | null> {
    const row = await this.prisma.subscription.findFirst({ where: { id, tenantId } });
    return row === null ? null : PrismaSubscriptionRepository.toDomain(row);
  }

  async findActiveByTenant(tenantId: UUID): Promise<Subscription | null> {
    const row = await this.prisma.subscription.findFirst({
      where: { tenantId, status: 'active' },
      orderBy: DEFAULT_ORDER_BY,
    });
    return row === null ? null : PrismaSubscriptionRepository.toDomain(row);
  }

  async findByTenant(tenantId: UUID): Promise<Subscription[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { tenantId },
      orderBy: DEFAULT_ORDER_BY,
    });
    return rows.map((row) => PrismaSubscriptionRepository.toDomain(row));
  }

  async create(subscription: Subscription): Promise<Subscription> {
    const row = await this.prisma.subscription.create({
      data: {
        id: subscription.id,
        tenantId: subscription.tenantId,
        planId: subscription.planId,
        status: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        autoRenew: subscription.autoRenew,
      },
    });
    return PrismaSubscriptionRepository.toDomain(row);
  }

  async update(subscription: Subscription): Promise<Subscription> {
    const row = await this.prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        planId: subscription.planId,
        status: subscription.status,
        startDate: subscription.startDate,
        endDate: subscription.endDate,
        autoRenew: subscription.autoRenew,
      },
    });
    return PrismaSubscriptionRepository.toDomain(row);
  }

  private static toDomain(row: SubscriptionRow): Subscription {
    return Subscription.reconstitute(row.id, {
      tenantId: row.tenantId,
      planId: row.planId,
      status: assertSubscriptionStatus(row.status),
      startDate: row.startDate,
      endDate: row.endDate as Nullable<Date>,
      autoRenew: row.autoRenew,
    });
  }
}
