/**
 * Centralised, named cache time-to-live (TTL) constants and cache namespaces for
 * the query-result caching strategy (task 39.4, Requirement 26.1).
 *
 * Query-result caches trade a little staleness for a large read-throughput win.
 * How much staleness is acceptable differs per data type, so each cache type has
 * its OWN, documented TTL rather than a single global value:
 *
 * - **Product / customer lists** change relatively often (a create/update/delete
 *   mutates them) and are read on nearly every catalogue/CRM screen, so they use
 *   a SHORT TTL — long enough to absorb bursts of identical list requests, short
 *   enough that even if an invalidation is missed the data self-heals quickly.
 * - **Configuration data** changes rarely (an admin toggling a setting) yet is
 *   read on almost every request, so it uses a LONGER TTL to maximise the hit
 *   rate; correctness is still guaranteed because {@link SetConfigurationUseCase}
 *   invalidates the affected entries on write.
 *
 * Living in the application layer (depending on nothing) keeps these values a
 * single source of truth shared by the use cases (defaults) and the composition
 * root (explicit wiring), without coupling business logic to any cache
 * technology.
 */

/**
 * TTL for cached product LIST/SEARCH pages: 60 seconds.
 *
 * Product lists are high-read, moderate-write. A one-minute window collapses
 * repeated identical listings into a single database query while keeping the
 * catalogue fresh; mutations bump the list version for immediate invalidation,
 * so this TTL is only the worst-case self-heal bound (e.g. after a missed
 * cross-instance invalidation).
 */
export const PRODUCT_LIST_CACHE_TTL_SECONDS = 60;

/**
 * TTL for cached customer LIST/SEARCH pages: 60 seconds.
 *
 * Same rationale as {@link PRODUCT_LIST_CACHE_TTL_SECONDS}: customer directories
 * are read constantly but mutated far less often, so a short TTL plus
 * version-based invalidation keeps reads cheap and data fresh.
 */
export const CUSTOMER_LIST_CACHE_TTL_SECONDS = 60;

/**
 * TTL for cached tenant configuration data: 600 seconds (10 minutes).
 *
 * Configuration changes rarely, so a longer TTL maximises the hit rate for the
 * many reads that consult settings. Correctness does not rely on the TTL:
 * {@link SetConfigurationUseCase} invalidates both the single-key and full-list
 * entries on every write, so a configuration change is reflected immediately —
 * the TTL is purely the fallback expiry for entries that are never re-written.
 */
export const CONFIGURATION_CACHE_TTL_SECONDS = 600;

/**
 * Cache namespace for product list/search results
 * (`product-list:<tenantId>:v<version>:<fingerprint>`).
 *
 * Shared verbatim by {@link ListProductsUseCase}/{@link SearchProductsUseCase}
 * (which POPULATE the namespace) and by the product mutation use cases (which
 * INVALIDATE it by bumping the per-tenant version), so read and write paths
 * always agree. See {@link VersionedListCache} for the key format.
 */
export const PRODUCT_LIST_CACHE_NAMESPACE = 'product-list';

/**
 * Cache namespace for customer list/search results
 * (`customer-list:<tenantId>:v<version>:<fingerprint>`). Shared by the customer
 * list/search reads and the customer mutation use cases. See
 * {@link VersionedListCache}.
 */
export const CUSTOMER_LIST_CACHE_NAMESPACE = 'customer-list';
