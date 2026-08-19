import type { UUID } from '@shared/types/index.js';
import { Money } from '@shared/value-objects/money.js';
import { Plan } from '../domain/entities/plan.js';
import type { IPlanRepository } from '../domain/repositories/plan-repository.js';
import { assertBillingCycle } from '../domain/value-objects/billing-cycle.js';
import { DEFAULT_PLAN_CURRENCY } from '../application/dto/subscription-dtos.js';

/** Anything that stringifies to a decimal (Prisma `Decimal`, number or string). */
export interface DecimalLike {
  toString(): string;
}

/** Persistence row for a `Plan` (structural subset of Prisma's generated type). */
export interface PlanRow {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  price: DecimalLike;
  billingCycle: string;
  /** `Plan.features` JSON column: an array of feature-name strings. */
  features: unknown;
  isActive: boolean;
}

/** Minimal `plan` delegate surface used by {@link PrismaPlanRepository}. */
export interface PlanModelDelegate {
  findUnique(args: { where: Record<string, unknown> }): Promise<PlanRow | null>;
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: Record<string, unknown> | Record<string, unknown>[];
  }): Promise<PlanRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<PlanRow>;
  update(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<PlanRow>;
}

/** A Prisma-like client exposing the `plan` delegate. */
export interface PlanPrismaClient {
  plan: PlanModelDelegate;
}

/** Plans are listed by (ascending) price by default — cheapest tier first. */
const DEFAULT_ORDER_BY = { price: 'asc' } as const;

/** Normalises the `Plan.features` JSON value into a list of feature-name strings. */
function parseFeatures(features: unknown): string[] {
  if (!Array.isArray(features)) {
    return [];
  }
  return features.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Prisma-backed {@link IPlanRepository}.
 *
 * **Client choice:** bound (in the composition root) to the UNEXTENDED
 * `systemPrisma` client. `Plan` is a platform-global catalogue with no
 * `tenantId`, so there is no tenant to scope by. `Plan.price` maps to/from a
 * bare `Decimal(10,2)` column using a configured currency (there is no currency
 * column); `Plan.features` maps to/from the `Json` column as a string array.
 */
export class PrismaPlanRepository implements IPlanRepository {
  constructor(
    private readonly prisma: PlanPrismaClient,
    private readonly currency: string = DEFAULT_PLAN_CURRENCY,
  ) {}

  async findById(id: UUID): Promise<Plan | null> {
    const row = await this.prisma.plan.findUnique({ where: { id } });
    return row === null ? null : this.toDomain(row);
  }

  async findByName(name: string): Promise<Plan | null> {
    const row = await this.prisma.plan.findUnique({ where: { name } });
    return row === null ? null : this.toDomain(row);
  }

  async findActive(): Promise<Plan[]> {
    const rows = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: DEFAULT_ORDER_BY,
    });
    return rows.map((row) => this.toDomain(row));
  }

  async findAll(): Promise<Plan[]> {
    const rows = await this.prisma.plan.findMany({ orderBy: DEFAULT_ORDER_BY });
    return rows.map((row) => this.toDomain(row));
  }

  async create(plan: Plan): Promise<Plan> {
    const row = await this.prisma.plan.create({ data: this.toPersistence(plan, plan.id) });
    return this.toDomain(row);
  }

  async update(plan: Plan): Promise<Plan> {
    const row = await this.prisma.plan.update({
      where: { id: plan.id },
      data: this.toPersistence(plan),
    });
    return this.toDomain(row);
  }

  private toPersistence(plan: Plan, id?: UUID): Record<string, unknown> {
    const data: Record<string, unknown> = {
      name: plan.name,
      displayName: plan.displayName,
      description: plan.description,
      price: plan.price.toDecimalString(),
      billingCycle: plan.billingCycle,
      features: plan.features,
      isActive: plan.isActive,
    };
    if (id !== undefined) {
      data.id = id;
    }
    return data;
  }

  private toDomain(row: PlanRow): Plan {
    return Plan.reconstitute(row.id, {
      name: row.name,
      displayName: row.displayName,
      description: row.description,
      price: Money.fromDecimal(row.price.toString(), this.currency),
      billingCycle: assertBillingCycle(row.billingCycle),
      features: parseFeatures(row.features),
      isActive: row.isActive,
    });
  }
}
