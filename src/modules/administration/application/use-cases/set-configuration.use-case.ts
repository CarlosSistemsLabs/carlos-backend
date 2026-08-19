import { ValidationError } from '@domain/errors/index.js';
import type { ICache } from '@application/ports/cache.js';
import { NoOpCache } from '@application/cache/no-op-cache.js';
import type {
  ConfigurationEntry,
  IConfigurationRepository,
} from '../../domain/repositories/configuration-repository.js';
import {
  tenantConfigurationCacheKey,
  tenantConfigurationsCacheKey,
  type SetConfigurationInputDto,
} from '../dto/administration-dtos.js';

/**
 * Creates or overwrites a tenant configuration entry (Requirements 11.1, 26.1 /
 * 28.5).
 *
 * Keyed by `(tenantId, key)` with upsert semantics, so setting an existing key
 * replaces its JSON value while a new key is inserted. The key is validated as a
 * non-empty string; the value may be any JSON-serialisable value (including
 * `null`, objects and arrays).
 *
 * **Cache invalidation (task 39.4, Requirement 26.1).** After a successful
 * upsert BOTH cached configuration views are invalidated: the single-key entry
 * (`tenant-config:<tenantId>:<key>`, read by {@link GetConfigurationUseCase})
 * and the full-list entry (`tenant-config:<tenantId>`, read by
 * {@link ListConfigurationsUseCase}), so the next read of either reflects the
 * change immediately. Invalidation is best-effort and never throws — the
 * {@link ICache} contract already swallows failures, and a missed invalidation
 * self-heals when the entry's TTL elapses.
 *
 * @throws {ValidationError} when the key is empty.
 */
export class SetConfigurationUseCase {
  constructor(
    private readonly configurations: IConfigurationRepository,
    private readonly cache: ICache = new NoOpCache(),
  ) {}

  async execute(input: SetConfigurationInputDto): Promise<ConfigurationEntry> {
    if (typeof input.key !== 'string' || input.key.trim().length === 0) {
      throw new ValidationError('Configuration key is required', { field: 'key' });
    }

    const key = input.key.trim();
    const saved = await this.configurations.set(input.tenantId, key, input.value);

    // Invalidate the single-key entry and the full-list entry so both read paths
    // reflect the change on their next call (Requirement 26.1).
    await Promise.all([
      this.cache.del(tenantConfigurationCacheKey(input.tenantId, key)),
      this.cache.del(tenantConfigurationsCacheKey(input.tenantId)),
    ]);

    return saved;
  }
}
