import { describe, it, expect, vi } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import {
  PrismaPlanRepository,
  type PlanPrismaClient,
  type PlanRow,
} from './prisma-plan-repository.js';
import { Plan } from '../domain/entities/plan.js';

function makeRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: 'plan-1',
    name: 'business',
    displayName: 'Business',
    description: 'desc',
    price: '79.00',
    billingCycle: 'monthly',
    features: ['sales', 'customers', 'stock'],
    isActive: true,
    ...overrides,
  };
}

function makeClient(): {
  client: PlanPrismaClient;
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  const findUnique = vi.fn();
  const findMany = vi.fn();
  const create = vi.fn();
  const update = vi.fn();
  const client: PlanPrismaClient = { plan: { findUnique, findMany, create, update } };
  return { client, findUnique, findMany, create, update };
}

describe('PrismaPlanRepository', () => {
  it('maps a row to a domain Plan (Decimal→Money, Json→features)', async () => {
    const { client, findUnique } = makeClient();
    findUnique.mockResolvedValue(makeRow());
    const repo = new PrismaPlanRepository(client);

    const plan = await repo.findById('plan-1');

    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'plan-1' } });
    expect(plan).not.toBeNull();
    expect(plan!.name).toBe('business');
    expect(plan!.price.toDecimalString()).toBe('79.00');
    expect(plan!.price.currency).toBe('USD');
    expect(plan!.features).toEqual(['sales', 'customers', 'stock']);
  });

  it('honours a configured currency', async () => {
    const { client, findUnique } = makeClient();
    findUnique.mockResolvedValue(makeRow());
    const repo = new PrismaPlanRepository(client, 'ARS');

    const plan = await repo.findById('plan-1');

    expect(plan!.price.currency).toBe('ARS');
  });

  it('tolerates a malformed (non-array) features JSON as empty', async () => {
    const { client, findUnique } = makeClient();
    findUnique.mockResolvedValue(makeRow({ features: null }));
    const repo = new PrismaPlanRepository(client);

    const plan = await repo.findById('plan-1');

    expect(plan!.features).toEqual([]);
  });

  it('findByName queries by unique name', async () => {
    const { client, findUnique } = makeClient();
    findUnique.mockResolvedValue(null);
    const repo = new PrismaPlanRepository(client);

    const plan = await repo.findByName('starter');

    expect(findUnique).toHaveBeenCalledWith({ where: { name: 'starter' } });
    expect(plan).toBeNull();
  });

  it('findActive filters to active plans ordered by price', async () => {
    const { client, findMany } = makeClient();
    findMany.mockResolvedValue([makeRow()]);
    const repo = new PrismaPlanRepository(client);

    const plans = await repo.findActive();

    expect(findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });
    expect(plans).toHaveLength(1);
  });

  it('create persists the plan and maps the returned row', async () => {
    const { client, create } = makeClient();
    create.mockImplementation((args: { data: PlanRow }) => Promise.resolve(args.data));
    const repo = new PrismaPlanRepository(client);
    const plan = Plan.create(
      {
        name: 'enterprise',
        displayName: 'Enterprise',
        price: Money.fromDecimal('199.00', 'USD'),
        billingCycle: 'yearly',
        features: ['sales'],
      },
      'plan-ent',
    );

    const saved = await repo.create(plan);

    const data = create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.id).toBe('plan-ent');
    expect(data.name).toBe('enterprise');
    expect(data.price).toBe('199.00');
    expect(data.billingCycle).toBe('yearly');
    expect(data.features).toEqual(['sales']);
    expect(saved.name).toBe('enterprise');
  });

  it('update writes changes by id without an id in the data payload', async () => {
    const { client, update } = makeClient();
    update.mockResolvedValue(makeRow({ isActive: false }));
    const repo = new PrismaPlanRepository(client);
    const plan = Plan.reconstitute('plan-1', {
      name: 'business',
      displayName: 'Business',
      description: null,
      price: Money.fromDecimal('79.00', 'USD'),
      billingCycle: 'monthly',
      features: ['sales'],
      isActive: false,
    });

    await repo.update(plan);

    const call = update.mock.calls[0]![0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: 'plan-1' });
    expect(call.data).not.toHaveProperty('id');
    expect(call.data.isActive).toBe(false);
  });
});
