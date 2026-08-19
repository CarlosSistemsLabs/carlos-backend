import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ICache } from '@application/ports/cache.js';
import { InMemoryCache } from '@infrastructure/cache/in-memory-cache.js';
import { SetConfigurationUseCase } from './set-configuration.use-case.js';
import { GetConfigurationUseCase } from './get-configuration.use-case.js';
import { ListConfigurationsUseCase } from './list-configurations.use-case.js';
import type {
  ConfigurationEntry,
  IConfigurationRepository,
} from '../../domain/repositories/configuration-repository.js';
import { NotFoundError } from '@domain/errors/index.js';

function makeConfigurations(): IConfigurationRepository {
  return {
    get: vi.fn().mockResolvedValue({ key: 'k', value: 42 } satisfies ConfigurationEntry),
    set: vi.fn(async (_tenantId: string, key: string, value: unknown) => ({
      key,
      value,
    })) as IConfigurationRepository['set'],
    list: vi.fn().mockResolvedValue([{ key: 'k', value: 42 }] as ConfigurationEntry[]),
    delete: vi.fn().mockResolvedValue(undefined),
  };
}

describe('GetConfigurationUseCase caching', () => {
  let configurations: IConfigurationRepository;
  let cache: InMemoryCache;

  beforeEach(() => {
    configurations = makeConfigurations();
    cache = new InMemoryCache();
  });

  it('serves a repeated read from cache without touching the repository', async () => {
    const useCase = new GetConfigurationUseCase(configurations, cache);
    await useCase.execute({ tenantId: 't1', key: 'k' });
    await useCase.execute({ tenantId: 't1', key: 'k' });
    expect(configurations.get).toHaveBeenCalledOnce();
  });

  it('does not cache a not-found result', async () => {
    vi.mocked(configurations.get).mockResolvedValue(null);
    const useCase = new GetConfigurationUseCase(configurations, cache);
    await expect(useCase.execute({ tenantId: 't1', key: 'missing' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(useCase.execute({ tenantId: 't1', key: 'missing' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(configurations.get).toHaveBeenCalledTimes(2);
  });

  it('returns correct data when the cache throws', async () => {
    const throwing: ICache = {
      get: vi.fn().mockRejectedValue(new Error('down')),
      set: vi.fn().mockRejectedValue(new Error('down')),
      del: vi.fn().mockRejectedValue(new Error('down')),
    };
    const useCase = new GetConfigurationUseCase(configurations, throwing);
    await expect(useCase.execute({ tenantId: 't1', key: 'k' })).resolves.toEqual({
      key: 'k',
      value: 42,
    });
  });
});

describe('ListConfigurationsUseCase caching', () => {
  let configurations: IConfigurationRepository;
  let cache: InMemoryCache;

  beforeEach(() => {
    configurations = makeConfigurations();
    cache = new InMemoryCache();
  });

  it('serves a repeated list from cache', async () => {
    const useCase = new ListConfigurationsUseCase(configurations, cache);
    await useCase.execute({ tenantId: 't1' });
    await useCase.execute({ tenantId: 't1' });
    expect(configurations.list).toHaveBeenCalledOnce();
  });
});

describe('SetConfigurationUseCase invalidation', () => {
  let configurations: IConfigurationRepository;
  let cache: InMemoryCache;

  beforeEach(() => {
    configurations = makeConfigurations();
    cache = new InMemoryCache();
  });

  it('invalidates the single-key entry so the next get is a repository miss', async () => {
    const get = new GetConfigurationUseCase(configurations, cache);
    const set = new SetConfigurationUseCase(configurations, cache);

    await get.execute({ tenantId: 't1', key: 'k' }); // populate
    await get.execute({ tenantId: 't1', key: 'k' }); // hit
    expect(configurations.get).toHaveBeenCalledOnce();

    await set.execute({ tenantId: 't1', key: 'k', value: 99 }); // invalidate
    await get.execute({ tenantId: 't1', key: 'k' }); // miss again

    expect(configurations.get).toHaveBeenCalledTimes(2);
  });

  it('invalidates the full-list entry so the next list is a repository miss', async () => {
    const list = new ListConfigurationsUseCase(configurations, cache);
    const set = new SetConfigurationUseCase(configurations, cache);

    await list.execute({ tenantId: 't1' }); // populate
    await list.execute({ tenantId: 't1' }); // hit
    expect(configurations.list).toHaveBeenCalledOnce();

    await set.execute({ tenantId: 't1', key: 'k', value: 99 }); // invalidate
    await list.execute({ tenantId: 't1' }); // miss again

    expect(configurations.list).toHaveBeenCalledTimes(2);
  });
});
