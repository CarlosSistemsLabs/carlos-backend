import { describe, it, expect, vi } from 'vitest';
import { Money } from '@shared/value-objects/money.js';
import { SeedPlansUseCase } from './seed-plans.use-case.js';
import { Plan } from '../../domain/entities/plan.js';
import type { IPlanRepository } from '../../domain/repositories/plan-repository.js';
import { PLAN_FEATURE_MATRIX, PLAN_NAMES } from '../../domain/constants/plan-features.js';

function existingPlan(name: string, displayName = name): Plan {
  return Plan.create(
    {
      name,
      displayName,
      price: Money.fromDecimal('10.00', 'USD'),
      billingCycle: 'monthly',
      features: ['sales'],
    },
    `existing-${name}`,
  );
}

function makeRepo(existingByName: Record<string, Plan> = {}): {
  repo: IPlanRepository;
  create: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn().mockImplementation((plan: Plan) => Promise.resolve(plan));
  const repo: IPlanRepository = {
    findById: vi.fn(),
    findByName: vi
      .fn()
      .mockImplementation((name: string) => Promise.resolve(existingByName[name] ?? null)),
    findActive: vi.fn(),
    findAll: vi.fn(),
    create,
    update: vi.fn(),
  };
  return { repo, create };
}

describe('SeedPlansUseCase', () => {
  it('seeds Starter/Business/Enterprise with the canonical feature sets', async () => {
    const { repo, create } = makeRepo();
    const useCase = new SeedPlansUseCase(repo);

    const output = await useCase.execute();

    expect(output.map((p) => p.name)).toEqual(['starter', 'business', 'enterprise']);
    expect(create).toHaveBeenCalledTimes(3);

    const byName = Object.fromEntries(output.map((p) => [p.name, p]));
    expect(byName[PLAN_NAMES.STARTER]!.features).toEqual([
      ...PLAN_FEATURE_MATRIX[PLAN_NAMES.STARTER],
    ]);
    expect(byName[PLAN_NAMES.BUSINESS]!.features).toEqual([
      ...PLAN_FEATURE_MATRIX[PLAN_NAMES.BUSINESS],
    ]);
    expect(byName[PLAN_NAMES.ENTERPRISE]!.features).toEqual([
      ...PLAN_FEATURE_MATRIX[PLAN_NAMES.ENTERPRISE],
    ]);
    expect(byName[PLAN_NAMES.ENTERPRISE]!.currency).toBe('USD');
    expect(byName[PLAN_NAMES.STARTER]!.isActive).toBe(true);
  });

  it('is idempotent: existing plans are returned untouched and not recreated', async () => {
    const { repo, create } = makeRepo({ starter: existingPlan('starter', 'Starter (custom)') });
    const useCase = new SeedPlansUseCase(repo);

    const output = await useCase.execute();

    // Only Business + Enterprise are created; Starter already exists.
    expect(create).toHaveBeenCalledTimes(2);
    const starter = output.find((p) => p.name === 'starter');
    expect(starter?.id).toBe('existing-starter');
    expect(starter?.displayName).toBe('Starter (custom)');
  });

  it('is fully idempotent when every plan already exists', async () => {
    const { repo, create } = makeRepo({
      starter: existingPlan('starter'),
      business: existingPlan('business'),
      enterprise: existingPlan('enterprise'),
    });
    const useCase = new SeedPlansUseCase(repo);

    const output = await useCase.execute();

    expect(create).not.toHaveBeenCalled();
    expect(output).toHaveLength(3);
  });
});
