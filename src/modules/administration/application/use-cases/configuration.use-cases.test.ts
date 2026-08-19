import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SetConfigurationUseCase } from './set-configuration.use-case.js';
import { GetConfigurationUseCase } from './get-configuration.use-case.js';
import { ListConfigurationsUseCase } from './list-configurations.use-case.js';
import type {
  ConfigurationEntry,
  IConfigurationRepository,
} from '../../domain/repositories/configuration-repository.js';
import { NotFoundError, ValidationError } from '@domain/errors/index.js';

function makeConfigurations(): IConfigurationRepository {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(async (_tenantId: string, key: string, value: unknown) => ({
      key,
      value,
    })) as IConfigurationRepository['set'],
    list: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe('SetConfigurationUseCase', () => {
  let configurations: IConfigurationRepository;
  let useCase: SetConfigurationUseCase;

  beforeEach(() => {
    configurations = makeConfigurations();
    useCase = new SetConfigurationUseCase(configurations);
  });

  it('upserts a trimmed key with an arbitrary JSON value', async () => {
    const value = { nested: [1, 2, 3], on: true };
    const result = await useCase.execute({ tenantId: 't1', key: '  sales.tax  ', value });

    expect(configurations.set).toHaveBeenCalledWith('t1', 'sales.tax', value);
    expect(result).toEqual({ key: 'sales.tax', value });
  });

  it('allows a null value (clearing semantics at the value level)', async () => {
    await useCase.execute({ tenantId: 't1', key: 'flag', value: null });
    expect(configurations.set).toHaveBeenCalledWith('t1', 'flag', null);
  });

  it.each(['', '   '])('rejects an empty key %j', async (key) => {
    await expect(useCase.execute({ tenantId: 't1', key, value: 1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(configurations.set).not.toHaveBeenCalled();
  });
});

describe('GetConfigurationUseCase', () => {
  let configurations: IConfigurationRepository;
  let useCase: GetConfigurationUseCase;

  beforeEach(() => {
    configurations = makeConfigurations();
    useCase = new GetConfigurationUseCase(configurations);
  });

  it('returns the entry when present', async () => {
    const entry: ConfigurationEntry = { key: 'k', value: 42 };
    vi.mocked(configurations.get).mockResolvedValue(entry);

    await expect(useCase.execute({ tenantId: 't1', key: 'k' })).resolves.toEqual(entry);
    expect(configurations.get).toHaveBeenCalledWith('t1', 'k');
  });

  it('throws NotFoundError when the key is absent', async () => {
    vi.mocked(configurations.get).mockResolvedValue(null);
    await expect(useCase.execute({ tenantId: 't1', key: 'missing' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('ListConfigurationsUseCase', () => {
  it('returns every configuration entry for the tenant', async () => {
    const configurations = makeConfigurations();
    const entries: ConfigurationEntry[] = [
      { key: 'a', value: 1 },
      { key: 'b', value: false },
    ];
    vi.mocked(configurations.list).mockResolvedValue(entries);
    const useCase = new ListConfigurationsUseCase(configurations);

    await expect(useCase.execute({ tenantId: 't1' })).resolves.toEqual(entries);
    expect(configurations.list).toHaveBeenCalledWith('t1');
  });
});
