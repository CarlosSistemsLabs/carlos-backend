import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UpdateTenantBrandingUseCase } from './update-tenant-branding.use-case.js';
import { Tenant } from '../../domain/entities/tenant.js';
import type { ITenantRepository } from '../../domain/repositories/tenant-repository.js';
import { NotFoundError, ValidationError } from '@domain/errors/index.js';

function makeTenants(seed?: Tenant): ITenantRepository {
  return {
    findById: vi.fn().mockResolvedValue(seed ?? null),
    findBySlug: vi.fn().mockResolvedValue(null),
    create: vi.fn(async (tenant: Tenant) => tenant),
    update: vi.fn(async (tenant: Tenant) => tenant),
    softDelete: vi.fn().mockResolvedValue(undefined),
  };
}

describe('UpdateTenantBrandingUseCase', () => {
  let tenant: Tenant;
  let tenants: ITenantRepository;
  let useCase: UpdateTenantBrandingUseCase;

  beforeEach(() => {
    tenant = Tenant.create(
      { name: 'Acme', slug: 'acme', theme: 'light', primaryColor: '#111111' },
      'tenant-1',
    );
    tenants = makeTenants(tenant);
    useCase = new UpdateTenantBrandingUseCase(tenants);
  });

  it('updates provided branding fields and persists them', async () => {
    const result = await useCase.execute({
      id: 'tenant-1',
      name: 'Acme LLC',
      theme: 'dark',
      secondaryColor: '#abc',
      currency: 'USD',
    });

    expect(tenants.update).toHaveBeenCalledOnce();
    expect(result.name).toBe('Acme LLC');
    expect(result.theme).toBe('dark');
    expect(result.secondaryColor).toBe('#aabbcc');
    expect(result.currency).toBe('USD');
    // Unspecified fields are unchanged.
    expect(result.primaryColor).toBe('#111111');
    expect(result.slug).toBe('acme');
  });

  it('clears an optional field when passed null', async () => {
    const result = await useCase.execute({ id: 'tenant-1', primaryColor: null });
    expect(result.primaryColor).toBeNull();
  });

  it('throws NotFoundError when the tenant does not exist', async () => {
    tenants = makeTenants(undefined);
    useCase = new UpdateTenantBrandingUseCase(tenants);

    await expect(useCase.execute({ id: 'missing', name: 'X' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(tenants.update).not.toHaveBeenCalled();
  });

  it('rejects a malformed color without persisting', async () => {
    await expect(
      useCase.execute({ id: 'tenant-1', primaryColor: 'not-a-color' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(tenants.update).not.toHaveBeenCalled();
  });

  it('rejects an invalid theme without persisting', async () => {
    await expect(useCase.execute({ id: 'tenant-1', theme: 'rainbow' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(tenants.update).not.toHaveBeenCalled();
  });
});
