import type { Nullable, PaginatedResult, UUID } from '@shared/types/index.js';

/**
 * A single, immutable audit-trail record as read back from the `AuditLog` table
 * (Requirement 18.2). This is a read model: the audit WRITE pipeline (task 43.4)
 * owns creating these rows; this module only reads them (Requirement 18.4).
 */
export interface AuditLogRecord {
  id: UUID;
  tenantId: UUID;
  userId: Nullable<UUID>;
  entityType: string;
  entityId: string;
  /** `"CREATE" | "UPDATE" | "DELETE"` — stored as a free string column. */
  action: string;
  oldValues: unknown;
  newValues: unknown;
  ipAddress: Nullable<string>;
  userAgent: Nullable<string>;
  timestamp: Date;
}

/** Optional filters applied when querying the audit trail. */
export interface AuditLogFilters {
  entityType?: string;
  entityId?: string;
  userId?: UUID;
  action?: string;
  /** Inclusive lower bound on `timestamp`. */
  from?: Date;
  /** Inclusive upper bound on `timestamp`. */
  to?: Date;
}

/** A paginated, filtered audit-log query. */
export interface AuditLogQuery {
  page: number;
  pageSize: number;
  filters?: AuditLogFilters;
}

/**
 * Read-only persistence abstraction over the append-only `AuditLog` table.
 *
 * The port exposes no create/update/delete: audit records are immutable
 * (Requirement 18.5) and written by the audit pipeline (task 43.4). Queries are
 * always tenant-scoped so a caller can only read its own tenant's trail
 * (Requirement 18.4).
 */
export interface IAuditLogRepository {
  /**
   * Returns a page of audit records for the tenant, newest first, applying the
   * optional filters (entity type/id, user, action, timestamp range).
   */
  findMany(tenantId: UUID, query: AuditLogQuery): Promise<PaginatedResult<AuditLogRecord>>;
}
