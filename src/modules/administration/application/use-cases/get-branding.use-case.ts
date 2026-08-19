import { NotFoundError } from '@domain/errors/index.js';
import type { ICache } from '@application/ports/cache.js';
import { staleOnError, type DegradationLogger } from '@common/resilience/index.js';
import type { ITenantRepository } from '../../domain/repositories/tenant-repository.js';
import {
  brandingCacheKey,
  brandingStaleCacheKey,
  toTenantOutput,
  type GetBrandingInputDto,
  type TenantOutput,
} from '../dto/administration-dtos.js';

/** Default branding cache time-to-live: 5 minutes. */
export const DEFAULT_BRANDING_CACHE_TTL_SECONDS = 300;

/**
 * Reads a tenant's branding/customization configuration, backed by a
 * cache-aside strategy (task 27.3; Requirements 11.1, 11.2).
 *
 * The web/mobile clients call this on login to render the tenant's brand
 * (Requirement 11.2 — apply within 2 seconds). To keep that fast under load the
 * projection is cached in {@link ICache} keyed by `branding:<tenantId>`:
 *
 * - **cache hit** → the stored projection is returned WITHOUT touching the
 *   repository;
 * - **cache miss** → the tenant is loaded from the repository, mapped to its
 *   public projection, stored in the cache with a TTL, then returned.
 *
 * Writes ({@link UpdateBrandingUseCase}) invalidate this key immediately so a
 * branding change is reflected on the next read (Requirement 11.4 — apply
 * within 30 seconds). The in-memory cache backs this today; the Redis-backed
 * cache (task 39.1) satisfies the same {@link ICache} port, making the change
 * transparent here.
 *
 * ## Graceful degradation (task 41.4, Requirement 27.7)
 * Branding is a NON-CRITICAL, purely presentational read: rendering a
 * few-minutes-stale logo/colour is vastly preferable to failing the login UI if
 * the tenant store has a transient hiccup. So the repository load runs through
 * {@link staleOnError}, which retains the last successfully-read projection under
 * a separate {@link brandingStaleCacheKey} and serves it if a subsequent live
 * read fails TRANSIENTLY. A DELIBERATE {@link NotFoundError} (the tenant genuinely
 * does not exist) is NOT degraded — it still surfaces as a 404 — because serving
 * stale branding for a deleted tenant would be incorrect. Writes invalidate the
 * stale snapshot too, so it can never serve pre-update branding after a change.
 *
 * @throws {NotFoundError} when the tenant does not exist (or is soft-deleted).
 */
export class GetBrandingUseCase {
  private readonly logger: DegradationLogger | undefined;

  constructor(
    private readonly tenants: ITenantRepository,
    private readonly cache: ICache,
    private readonly ttlSeconds: number = DEFAULT_BRANDING_CACHE_TTL_SECONDS,
    logger?: DegradationLogger,
  ) {
    this.logger = logger;
  }

  async execute(input: GetBrandingInputDto): Promise<TenantOutput> {
    const key = brandingCacheKey(input.tenantId);

    const cached = await this.cache.get<TenantOutput>(key);
    if (cached !== null) {
      return cached;
    }

    const staleKey = brandingStaleCacheKey(input.tenantId);
    return staleOnError(
      this.cache,
      staleKey,
      async () => {
        const tenant = await this.tenants.findById(input.tenantId);
        if (tenant === null) {
          throw NotFoundError.forEntity('Tenant', input.tenantId);
        }
        const output = toTenantOutput(tenant);
        // Populate the fresh cache-aside entry (TTL-bounded) so subsequent reads
        // hit the fast path; staleOnError refreshes the last-known-good snapshot.
        await this.cache.set(key, output, this.ttlSeconds);
        return output;
      },
      {
        feature: 'tenant-branding',
        ...(this.logger !== undefined ? { logger: this.logger } : {}),
      },
    );
  }
}
