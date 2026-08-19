import type { ICache } from '@application/ports/cache.js';
import { NoOpCache } from '@application/cache/no-op-cache.js';
import { cacheAside } from '@application/cache/query-cache.js';
import { CONFIGURATION_CACHE_TTL_SECONDS } from '@application/cache/cache-ttls.js';
import type {
  ConfigurationEntry,
  IConfigurationRepository,
} from '../../domain/repositories/configuration-repository.js';
import {
  tenantConfigurationsCacheKey,
  type ListConfigurationsInputDto,
} from '../dto/administration-dtos.js';

/**
 * Lists every configuration entry for a tenant (Requirements 11.1, 26.1),
 * ordered by key by the repository. Returns an empty array when the tenant has
 * no entries.
 *
 * **Query-result caching (task 39.4, Requirement 26.1).** Configuration is read
 * on almost every request but changes rarely, so the full list is cached
 * cache-aside under `tenant-config:<tenantId>` with a longer TTL
 * ({@link CONFIGURATION_CACHE_TTL_SECONDS}). On a hit the cached list is returned
 * without touching the repository; on a miss the list is loaded and cached.
 * {@link SetConfigurationUseCase} invalidates this key on every write, so a
 * configuration change is reflected immediately regardless of the TTL. Caching
 * is best-effort and degrades to a direct repository query on a cache fault.
 */
export class ListConfigurationsUseCase {
  constructor(
    private readonly configurations: IConfigurationRepository,
    private readonly cache: ICache = new NoOpCache(),
    private readonly ttlSeconds: number = CONFIGURATION_CACHE_TTL_SECONDS,
  ) {}

  async execute(input: ListConfigurationsInputDto): Promise<ConfigurationEntry[]> {
    return cacheAside(
      this.cache,
      tenantConfigurationsCacheKey(input.tenantId),
      this.ttlSeconds,
      () => this.configurations.list(input.tenantId),
    );
  }
}
