import type { UUID } from '@shared/types/index.js';

/**
 * A JSON-serialisable value, mirroring the `Configuration.value Json` column
 * without importing Prisma into the domain (Clean Architecture, Requirement
 * 3.2).
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A single tenant configuration entry (a key/value pair). */
export interface ConfigurationEntry {
  key: string;
  value: JsonValue;
}

/**
 * Persistence abstraction for tenant {@link ConfigurationEntry} key/value pairs
 * (`Configuration` model, `@@unique([tenantId, key])`).
 *
 * Configurations ARE tenant-scoped, so the concrete implementation is bound to
 * the tenant-aware `tenantPrisma` client. Every method still takes `tenantId`
 * explicitly and applies it to the query for defence-in-depth and so the
 * repository behaves correctly outside a request context (e.g. during tenant
 * provisioning, where no request/tenant context exists yet — Requirement 1.5).
 */
export interface IConfigurationRepository {
  /** Reads a single configuration entry for the tenant, or `null` when absent. */
  get(tenantId: UUID, key: string): Promise<ConfigurationEntry | null>;

  /**
   * Upserts a configuration entry (insert or overwrite) on the
   * `@@unique([tenantId, key])` constraint. Returns the stored entry.
   */
  set(tenantId: UUID, key: string, value: JsonValue): Promise<ConfigurationEntry>;

  /** Lists every configuration entry for the tenant (ordered by key). */
  list(tenantId: UUID): Promise<ConfigurationEntry[]>;

  /** Removes a configuration entry; a no-op when the key does not exist. */
  delete(tenantId: UUID, key: string): Promise<void>;
}
