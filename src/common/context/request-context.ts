import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context propagated across application layers.
 *
 * Holds correlation and tenant-isolation identifiers so use cases, repositories,
 * and infrastructure can access them without threading a request object through
 * every call (Requirement 21.2 structured logging, multi-tenant isolation).
 *
 * `tenantId` and `userId` are optional here: they are populated once the auth
 * middleware decodes the JWT (task 6.2). The request context is seeded with the
 * `requestId` at the start of every request.
 */
export interface RequestContext {
  /** Correlation id for the current request (mirrors `x-request-id`). */
  requestId: string;
  /** Tenant the request operates on, once resolved from the JWT. */
  tenantId?: string;
  /** Authenticated user id, once resolved from the JWT. */
  userId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with the provided context bound to the async execution scope.
 * Prefer this in tests or isolated tasks where a callback boundary exists.
 */
export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/**
 * Binds the context to the current async execution without a callback boundary.
 * Used by the Fastify `onRequest` hook so the context remains available for the
 * entire request lifecycle (handlers, hooks, and downstream awaited calls).
 */
export function enterContext(context: RequestContext): void {
  storage.enterWith(context);
}

/** Returns the active request context, or `undefined` outside a request scope. */
export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Returns the active request id, or `undefined` outside a request scope. */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Returns the active tenant id, or `undefined` when not yet resolved. */
export function getTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}

/** Returns the active user id, or `undefined` when not yet resolved. */
export function getUserId(): string | undefined {
  return storage.getStore()?.userId;
}

/**
 * Sets the tenant id on the active context. No-op outside a request scope.
 * Invoked by the auth middleware after decoding the JWT (task 6.2).
 */
export function setTenantId(tenantId: string): void {
  const store = storage.getStore();
  if (store) {
    store.tenantId = tenantId;
  }
}

/**
 * Sets the user id on the active context. No-op outside a request scope.
 * Invoked by the auth middleware after decoding the JWT (task 6.2).
 */
export function setUserId(userId: string): void {
  const store = storage.getStore();
  if (store) {
    store.userId = userId;
  }
}
