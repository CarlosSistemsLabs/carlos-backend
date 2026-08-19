import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateTenantUseCase } from './create-tenant.use-case.js';
import { Tenant } from '../../domain/entities/tenant.js';
import type { ITenantRepository } from '../../domain/repositories/tenant-repository.js';
import type {
  IConfigurationRepository,
  JsonValue,
} from '../../domain/repositories/configuration-repository.js';
import type { ITenantRoleSeeder } from '../../domain/repositories/tenant-role-seeder.js';
import { ConflictError, ValidationError } from '@domain/errors/index.js';
import { DEFAULT_TENANT_CONFIGURATIONS, type CreateTenantInputDto } from '../dto/administration-dtos.js';

function makeTenants(): ITenantRepository {
  return {
    findById: vi.fn().mockResolvedValue(null),
    findBySlug: vi.fn().mockResolvedValue(null),
    create: vi.fn(async (tenant: Tenant) => tenant),
    update: vi.fn(async (tenant: Tenant) => tenant),
    softDelete: vi.fn().mockResolvedValue(undefined),
  };
}

function makeSeeder(): ITenantRoleSeeder {
  return { execute: vi.fn().mockResolvedValue([]) };
}

function makeConfigurations(): IConfigurationRepository {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(async (_tenantId: string, key: string, value: JsonValue) => ({ key, value })),
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

const input: CreateTenantInputDto = {
  name: 'Acme Inc',
  slug: 'ACME',
  primaryColor: '#FFF',
  theme: 'dark',
};

describe('CreateTenantUseCase', () => {
  let tenants: ITenantRepository;
  let seeder: ITenantRoleSeeder;
  let configurations: IConfigurationRepository;
  let useCase: CreateTenantUseCase;

  beforeEach(() => {
    tenants = makeTenants();
    seeder = makeSeeder();
    configurations = makeConfigurations();
    useCase = new CreateTenantUseCase(tenants, seeder, configurations);
  });

  it('provisions a tenant: creates it, seeds roles, seeds default config', async () => {
    const result = await useCase.execute(input);

    // Slug normalised + uniqueness checked.
    expect(tenants.findBySlug).toHaveBeenCalledWith('acme');
    expect(tenants.create).toHaveBeenCalledOnce();

    // Roles seeded for the created tenant (Req 28.5).
    const created = vi.mocked(tenants.create).mock.calls[0]![0];
    expect(seeder.execute).toHaveBeenCalledWith({ tenantId: created.id });

    // Every default configuration entry seeded (upsert) for the tenant.
    expect(configurations.set).toHaveBeenCalledTimes(DEFAULT_TENANT_CONFIGURATIONS.length);
    for (const entry of DEFAULT_TENANT_CONFIGURATIONS) {
      expect(configurations.set).toHaveBeenCalledWith(created.id, entry.key, entry.value);
    }

    expect(result.slug).toBe('acme');
    expect(result.theme).toBe('dark');
    expect(result.primaryColor).toBe('#ffffff');
    expect(tenants.softDelete).not.toHaveBeenCalled();
  });

  it('seeds roles BEFORE configuration (ordering)', async () => {
    const order: string[] = [];
    vi.mocked(seeder.execute).mockImplementation(async () => {
      order.push('roles');
      return [];
    });
    vi.mocked(configurations.set).mockImplementation(async (_t, key, value) => {
      order.push('config');
      return { key, value };
    });

    await useCase.execute(input);

    expect(order[0]).toBe('roles');
    expect(order.slice(1).every((step) => step === 'config')).toBe(true);
  });

  it('throws ConflictError when the slug already exists and does not create', async () => {
    vi.mocked(tenants.findBySlug).mockResolvedValue(Tenant.create({ name: 'Other', slug: 'acme' }));

    await expect(useCase.execute(input)).rejects.toBeInstanceOf(ConflictError);
    expect(tenants.create).not.toHaveBeenCalled();
    expect(seeder.execute).not.toHaveBeenCalled();
  });

  it('rejects an invalid slug before touching the repository', async () => {
    await expect(useCase.execute({ name: 'Acme', slug: 'has space' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(tenants.findBySlug).not.toHaveBeenCalled();
    expect(tenants.create).not.toHaveBeenCalled();
  });

  it('compensates by soft-deleting the tenant when role seeding fails', async () => {
    vi.mocked(seeder.execute).mockRejectedValue(new Error('seed roles failed'));

    await expect(useCase.execute(input)).rejects.toThrow('seed roles failed');

    const created = vi.mocked(tenants.create).mock.calls[0]![0];
    expect(tenants.softDelete).toHaveBeenCalledWith(created.id);
    expect(configurations.set).not.toHaveBeenCalled();
  });

  it('compensates by soft-deleting the tenant when configuration seeding fails', async () => {
    vi.mocked(configurations.set).mockRejectedValue(new Error('seed config failed'));

    await expect(useCase.execute(input)).rejects.toThrow('seed config failed');

    const created = vi.mocked(tenants.create).mock.calls[0]![0];
    expect(seeder.execute).toHaveBeenCalledOnce();
    expect(tenants.softDelete).toHaveBeenCalledWith(created.id);
  });

  it('surfaces the original error even if compensation fails', async () => {
    vi.mocked(seeder.execute).mockRejectedValue(new Error('original'));
    vi.mocked(tenants.softDelete).mockRejectedValue(new Error('compensation failed'));

    await expect(useCase.execute(input)).rejects.toThrow('original');
  });
});
