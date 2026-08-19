import { describe, it, expect, vi } from 'vitest';
import { NotFoundError } from '@domain/errors/index.js';
import { Money } from '@shared/value-objects/money.js';
import { CreateSubscriptionUseCase } from './create-subscription.use-case.js';
import { Plan } from '../../domain/entities/plan.js';
import { Subscription } from '../../domain/entities/subscription.js';
import { InactivePlanError } from '../../domain/errors/subscription-errors.js';
import type { IPlanRepository } from '../../domain/repositories/plan-repository.js';
import type { ISubscriptionRepository } from '../../domain/repositories/subscription-repository.js';

const TENANT = 'tenant-1';
const NOW = new Date('2025-01-10T00:00:00.000Z');

function makePlan(overrides: Partial<Parameters<typeof Plan.create>[0]> = {}): Plan {
  return Plan.create(
    {
      name: 'business',
      displayName: 'Business',
      price: Money.fromDecimal('79.00', 'USD'),
      billingCycle: 'monthly',
      features: ['sales', 'customers', 'stock'],
      ...overrides,
    },
    'plan-1',
  );
}

function makePlans(plan: Plan | null): IPlanRepository {
  return {
    findById: vi.fn().mockResolvedValue(plan),
    findByName: vi.fn(),
    findActive: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  };
}

function makeSubscriptions(active: Subscription | null): {
  repo: ISubscriptionRepository;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn().mockImplementation((sub: Subscription) => Promise.resolve(sub));
  const update = vi.fn().mockImplementation((sub: Subscription) => Promise.resolve(sub));
  const repo: ISubscriptionRepository = {
    findById: vi.fn(),
    findActiveByTenant: vi.fn().mockResolvedValue(active),
    findByTenant: vi.fn(),
    create,
    update,
  };
  return { repo, create, update };
}

describe('CreateSubscriptionUseCase', () => {
  it('subscribes a tenant to a monthly plan, deriving a +1 month term', async () => {
    const plans = makePlans(makePlan());
    const { repo, create } = makeSubscriptions(null);
    const useCase = new CreateSubscriptionUseCase(repo, plans, () => NOW);

    const output = await useCase.execute({ tenantId: TENANT, planId: 'plan-1' });

    expect(output.tenantId).toBe(TENANT);
    expect(output.planId).toBe('plan-1');
    expect(output.status).toBe('active');
    expect(output.startDate).toBe(NOW.toISOString());
    expect(output.endDate).toBe(new Date('2025-02-10T00:00:00.000Z').toISOString());
    expect(create).toHaveBeenCalledOnce();
  });

  it('derives a +1 year term for a yearly plan', async () => {
    const plans = makePlans(makePlan({ billingCycle: 'yearly' }));
    const { repo } = makeSubscriptions(null);
    const useCase = new CreateSubscriptionUseCase(repo, plans, () => NOW);

    const output = await useCase.execute({ tenantId: TENANT, planId: 'plan-1' });

    expect(output.endDate).toBe(new Date('2026-01-10T00:00:00.000Z').toISOString());
  });

  it('honours an explicit endDate over the billing-cycle derivation', async () => {
    const plans = makePlans(makePlan());
    const { repo } = makeSubscriptions(null);
    const useCase = new CreateSubscriptionUseCase(repo, plans, () => NOW);
    const explicit = new Date('2025-06-30T00:00:00.000Z');

    const output = await useCase.execute({ tenantId: TENANT, planId: 'plan-1', endDate: explicit });

    expect(output.endDate).toBe(explicit.toISOString());
  });

  it('supersedes an existing active subscription by cancelling it', async () => {
    const plans = makePlans(makePlan());
    const existing = Subscription.create(
      { tenantId: TENANT, planId: 'plan-old', startDate: new Date('2024-12-01T00:00:00.000Z') },
      'sub-old',
    );
    const { repo, create, update } = makeSubscriptions(existing);
    const useCase = new CreateSubscriptionUseCase(repo, plans, () => NOW);

    await useCase.execute({ tenantId: TENANT, planId: 'plan-1' });

    expect(update).toHaveBeenCalledOnce();
    const superseded = update.mock.calls[0]![0] as Subscription;
    expect(superseded.id).toBe('sub-old');
    expect(superseded.status).toBe('cancelled');
    expect(create).toHaveBeenCalledOnce();
  });

  it('passes autoRenew through when provided', async () => {
    const plans = makePlans(makePlan());
    const { repo } = makeSubscriptions(null);
    const useCase = new CreateSubscriptionUseCase(repo, plans, () => NOW);

    const output = await useCase.execute({ tenantId: TENANT, planId: 'plan-1', autoRenew: false });

    expect(output.autoRenew).toBe(false);
  });

  it('throws NotFoundError when the plan does not exist', async () => {
    const plans = makePlans(null);
    const { repo } = makeSubscriptions(null);
    const useCase = new CreateSubscriptionUseCase(repo, plans, () => NOW);

    await expect(useCase.execute({ tenantId: TENANT, planId: 'missing' })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('throws InactivePlanError when the plan is inactive', async () => {
    const plan = makePlan();
    plan.deactivate();
    const plans = makePlans(plan);
    const { repo, create } = makeSubscriptions(null);
    const useCase = new CreateSubscriptionUseCase(repo, plans, () => NOW);

    await expect(useCase.execute({ tenantId: TENANT, planId: 'plan-1' })).rejects.toThrow(
      InactivePlanError,
    );
    expect(create).not.toHaveBeenCalled();
  });
});
