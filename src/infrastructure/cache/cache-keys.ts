import type { ICache } from '@application/ports/cache.js';

/**
 * Centralised cache-key namespacing + a reusable invalidation helper for the
 * multi-level caching strategy (task 39.2, Requirement 31.4).
 *
 * Cached entries are addressed by opaque string keys. Left uncoordinated, the
 * *read* path (which populates a key) and the *write* path (which must
 * invalidate the SAME key on an update/delete) can drift apart and leak stale
 * data. {@link CacheKeys} is the single source of truth for those keys so
 * cache-aside consumers always agree.
 *
 * Keys are namespaced `<entity>:<tenantId>[:<suffix>]` so per-entity, per-tenant
 * entries never collide and a whole entity's convention is discoverable in one
 * place. The existing branding cache-aside (`branding:<tenantId>`, see
 * `GetBrandingUseCase`/`UpdateBrandingUseCase`) is expressed here verbatim so
 * this helper and that module produce identical keys; query-result caches for
 * product/customer/configuration lists (task 39.4) build on the same helper.
 */
export const CacheKeys = {
  /**
   * Key for a tenant's branding projection (`branding:<tenantId>`). Matches the
   * key used by the Administration branding use cases so warming/invalidation
   * here targets the exact entry they read.
   */
  branding(tenantId: string): string {
    return `branding:${tenantId}`;
  },

  /**
   * Key for a tenant's full configuration list (`tenant-config:<tenantId>`).
   * Used by the cache warmer to pre-load tenant configurations (Requirement
   * 31.4) and by list-configuration reads (task 39.4).
   */
  tenantConfigurations(tenantId: string): string {
    return `tenant-config:${tenantId}`;
  },

  /**
   * Key for a single configuration entry (`tenant-config:<tenantId>:<key>`).
   */
  tenantConfiguration(tenantId: string, key: string): string {
    return `tenant-config:${tenantId}:${key}`;
  },

  /**
   * Key holding a tenant's PRODUCT-LIST cache version
   * (`product-list-version:<tenantId>`) — the counter mixed into every cached
   * product list/search key so a product mutation can invalidate the whole
   * namespace by bumping it (task 39.4, Requirement 26.1). The individual list
   * entry keys (`product-list:<tenantId>:v<version>:<fingerprint>`) are owned by
   * the application-layer `VersionedListCache`; this mirrors its version-key
   * format so infrastructure tooling can reference/clear it consistently.
   */
  productListVersion(tenantId: string): string {
    return `product-list-version:${tenantId}`;
  },

  /**
   * Key holding a tenant's CUSTOMER-LIST cache version
   * (`customer-list-version:<tenantId>`). Mirrors the application-layer
   * `VersionedListCache` version-key format (task 39.4, Requirement 26.1).
   */
  customerListVersion(tenantId: string): string {
    return `customer-list-version:${tenantId}`;
  },

  /**
   * Generic key builder for a tenant-scoped entity instance
   * (`<entity>:<tenantId>:<id>`). A convenience for modules that cache
   * individual records; keeping the format here guarantees the read and
   * invalidation paths agree.
   */
  entity(entity: string, tenantId: string, id: string): string {
    return `${entity}:${tenantId}:${id}`;
  },
} as const;

/**
 * Invalidates one or more cache keys, tolerating individual failures.
 *
 * A thin, reusable wrapper for the "invalidate on data update" concern: a use
 * case that mutates an entity calls this with the affected keys (built via
 * {@link CacheKeys}) after a successful persist, so the next read is fresh
 * within the 30-second budget (Requirement 31.4). Deletes are issued
 * concurrently and every key is attempted even if one rejects — matching the
 * never-throws contract of the {@link ICache} implementations. Returns once all
 * deletes have settled.
 *
 * @param cache - The cache whose entries to invalidate.
 * @param keys - The keys to delete (built via {@link CacheKeys}).
 */
export async function invalidateCacheKeys(
  cache: ICache,
  keys: readonly string[],
): Promise<void> {
  await Promise.all(
    keys.map(async (key) => {
      try {
        await cache.del(key);
      } catch {
        // The ICache contract is never-throws; swallow defensively so a single
        // failed key does not abort the others (or the caller's request).
      }
    }),
  );
}
