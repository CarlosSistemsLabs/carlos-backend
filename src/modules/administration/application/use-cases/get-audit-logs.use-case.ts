import type { PaginatedResult } from '@shared/types/index.js';
import type {
  AuditLogFilters,
  IAuditLogRepository,
} from '../../domain/repositories/audit-log-repository.js';
import type { AuditLogOutput, GetAuditLogsInputDto } from '../dto/administration-dtos.js';

/** Default page size when the caller does not specify one. */
const DEFAULT_PAGE_SIZE = 20;
/** Default (first) page when the caller does not specify one. */
const DEFAULT_PAGE = 1;

/**
 * Retrieves a tenant's audit trail with optional filtering + pagination
 * (Requirement 18.4 — audit-log queries).
 *
 * Read-only: the trail is append-only and immutable (Requirement 18.5), so this
 * use case only ever reads. The tenant is supplied by the presentation layer
 * from the authenticated admin's token (never the client), so a caller can only
 * ever read their own tenant's records. Results are returned newest-first and
 * paginated.
 */
export class GetAuditLogsUseCase {
  constructor(private readonly auditLogs: IAuditLogRepository) {}

  async execute(input: GetAuditLogsInputDto): Promise<PaginatedResult<AuditLogOutput>> {
    const page = input.page ?? DEFAULT_PAGE;
    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;

    const filters: AuditLogFilters = {
      ...(input.entityType !== undefined ? { entityType: input.entityType } : {}),
      ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.action !== undefined ? { action: input.action } : {}),
      ...(input.from !== undefined ? { from: input.from } : {}),
      ...(input.to !== undefined ? { to: input.to } : {}),
    };

    return this.auditLogs.findMany(input.tenantId, { page, pageSize, filters });
  }
}
