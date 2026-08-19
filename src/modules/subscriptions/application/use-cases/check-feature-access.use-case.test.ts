import { describe, it, expect, vi } from 'vitest';
import { CheckFeatureAccessUseCase } from './check-feature-access.use-case.js';
import type {
  FeatureAccessDecision,
  IFeatureAccessService,
} from '../../domain/services/feature-access-service.js';

const TENANT = 'tenant-1';

function makeService(decision: FeatureAccessDecision): {
  service: IFeatureAccessService;
  check: ReturnType<typeof vi.fn>;
} {
  const check = vi.fn().mockResolvedValue(decision);
  const service: IFeatureAccessService = {
    checkFeatureAccess: check,
    isFeatureEnabled: vi.fn(),
  };
  return { service, check };
}

describe('CheckFeatureAccessUseCase', () => {
  it('delegates to the feature-access service and maps an allowed decision', async () => {
    const { service, check } = makeService({ allowed: true });
    const useCase = new CheckFeatureAccessUseCase(service);

    const output = await useCase.execute({ tenantId: TENANT, feature: 'stock' });

    expect(check).toHaveBeenCalledWith(TENANT, 'stock');
    expect(output).toEqual({ tenantId: TENANT, feature: 'stock', allowed: true });
  });

  it('surfaces the denial reason when access is refused', async () => {
    const { service } = makeService({ allowed: false, reason: 'plan_excludes_feature' });
    const useCase = new CheckFeatureAccessUseCase(service);

    const output = await useCase.execute({ tenantId: TENANT, feature: 'purchases' });

    expect(output).toEqual({
      tenantId: TENANT,
      feature: 'purchases',
      allowed: false,
      reason: 'plan_excludes_feature',
    });
  });

  it('surfaces the no_active_subscription reason', async () => {
    const { service } = makeService({ allowed: false, reason: 'no_active_subscription' });
    const useCase = new CheckFeatureAccessUseCase(service);

    const output = await useCase.execute({ tenantId: TENANT, feature: 'sales' });

    expect(output.allowed).toBe(false);
    expect(output.reason).toBe('no_active_subscription');
  });
});
