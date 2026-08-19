import { NotFoundError } from '@domain/errors/index.js';
import type { ICache } from '@application/ports/cache.js';
import { NoOpCache } from '@application/cache/no-op-cache.js';
import { cacheAside } from '@application/cache/query-cache.js';
import { CONFIGURATION_CACHE_TTL_SECONDS } from '@application/cache/cache-ttls.js';
import type {
  ConfigurationEntry,
  IConfigurationRepository,
} from '../../domain/repositories/configuration-repository.js';
import {
  tenantConfigurationCacheKey,
  type GetConfigurationInputDto,
} from '../dto/administration-dtos.js';

/**
 * Reads a single tenant configuration entry by key (Requirements 11.1, 26.1).
 *
 * **Query-result caching (task 39.4, Requirement 26.1).** The entry is cached
 * cache-aside under `tenant-config:<tenantId>:<key>` with a longer TTL
 * ({@link CONFIGURATION_CACHE_TTL_SECONDS}) since configuration changes rarely.
 * Only EXISTING entries are cached — a missing key throws {@link NotFoundError}
 * before anything is stored, so error responses are never cached and a later
 * `set` of that key is served fresh. {@link SetConfigurationUseCase} invalidates
 * this key on write, so a change is reflected immediately. Caching is
 * best-effort and degrades to a direct repository query on a cache fault.
 *
 * @throws {NotFoundError} when no entry exists for the `(tenantId, key)` pair.
 */
export class GetConfigurationUseCase {
  constructor(
    private readonly configurations: IConfigurationRepository,
    private readonly cache: ICache = new NoOpCache(),
    private readonly ttlSeconds: number = CONFIGURATION_CACHE_TTL_SECONDS,
  ) {}

  async execute(input: GetConfigurationInputDto): Promise<ConfigurationEntry> {
    return cacheAside(
      this.cache,
      tenantConfigurationCacheKey(input.tenantId, input.key),
      this.ttlSeconds,
      async () => {
        const entry = await this.configurations.get(input.tenantId, input.key);
        if (entry === null) {
          throw NotFoundError.forEntity('Configuration', input.key);
        }
        return entry;
      },
    );
  }
}
