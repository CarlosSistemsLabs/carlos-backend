import { UnauthorizedError } from '@domain/errors';
import { getTenantId, getUserId } from './request-context.js';

/**
 * Returns the active tenant id, throwing {@link UnauthorizedError} when no
 * tenant has been resolved into the request context.
 *
 * Tenant-scoped use cases should call this (rather than the optional
 * {@link getTenantId} accessor) so a missing tenant fails fast and loudly
 * instead of silently producing a cross-tenant or unscoped query. This is the
 * application-layer guard backing the automatic tenant filtering required for
 * multi-tenant isolation (Requirement 1.2).
 */
export function requireTenantId(): string {
  const tenantId = getTenantId();
  if (tenantId === undefined || tenantId.length === 0) {
    throw new UnauthorizedError('Tenant context is required but was not resolved');
  }
  return tenantId;
}

/**
 * Returns the active user id, throwing {@link UnauthorizedError} when no user
 * has been resolved into the request context. Use in flows that require an
 * authenticated subject (e.g. attributing an action in the audit log).
 */
export function requireUserId(): string {
  const userId = getUserId();
  if (userId === undefined || userId.length === 0) {
    throw new UnauthorizedError('User context is required but was not resolved');
  }
  return userId;
}
