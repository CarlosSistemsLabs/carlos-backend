import type { FastifyInstance } from 'fastify';
import { registerRequestContext } from './request-context.js';
import { registerTenantContext } from './tenant-context.js';
import { registerSecurity } from './security.js';
import { registerInputSanitization } from '@presentation/sanitization';
import { registerRequestId } from './request-id.js';
import { registerRequestLogging } from './request-logging.js';
import { registerErrorHandler, type ErrorHandlerObservers } from './error-handler.js';
import type { ICrashReporter } from '@common/crash-reporting';

/**
 * Wires the cross-cutting HTTP middleware onto the Fastify instance.
 *
 * Registration order matters:
 * 1. Request context is seeded first so every later hook/handler can read the
 *    correlation id (and, later, tenant/user ids) from the context store.
 * 2. Security middleware (Helmet headers, CORS whitelist, per-user rate
 *    limiting, optional CSRF) is registered next so it wraps all routes and the
 *    rate limiter can key off the user id resolved into the request context.
 * 2b. Input sanitization (task 43.1, Requirement 17.5) runs as a global
 *    `preValidation` hook, deep-sanitizing `request.body` so every string field
 *    is stripped of XSS vectors before Zod validation and before any use
 *    case/repository sees it. Conservative by design: normal text passes
 *    through unchanged and credential fields are skipped.
 * 3. Tenant context propagation runs as a `preHandler`, after authentication
 *    (task 8.2) has attached the verified JWT payload, copying the tenant/user
 *    ids into the request context for downstream layers. It is a no-op until a
 *    verified payload is present.
 * 4. The request id is echoed onto the response headers.
 * 5. Response logging captures the structured per-request fields.
 * 6. The error handler is installed to map errors to the consistent envelope.
 *    Optional {@link ErrorHandlerObservers} wire the alerting monitors
 *    (task 31.4): 5xx errors feed the critical error-rate monitor and 401/403
 *    failures feed the suspicious-activity detector. 429 rate-limit hits feed
 *    the suspicious-activity detector and the security-audit log (task 43.4). An
 *    optional
 *    {@link ICrashReporter} (task 33.3) wires the external crash-reporting seam
 *    so 5xx/unknown errors are additionally forwarded to the crash tracker.
 */
export async function registerMiddlewares(
  app: FastifyInstance,
  errorObservers?: ErrorHandlerObservers,
  crashReporter?: ICrashReporter,
): Promise<void> {
  registerRequestContext(app);
  await registerSecurity(app);
  registerInputSanitization(app);
  registerTenantContext(app);
  registerRequestId(app);
  registerRequestLogging(app);
  registerErrorHandler(app, errorObservers, crashReporter);
}

export { REQUEST_ID_HEADER, resolveRequestId, registerRequestId } from './request-id.js';
export { registerRequestContext } from './request-context.js';
export {
  registerTenantContext,
  propagateTenantContext,
  type AuthenticatedPayload,
} from './tenant-context.js';
export { registerSecurity, parseAllowedOrigins } from './security.js';
export { registerInputSanitization } from '@presentation/sanitization';
export { registerRequestLogging } from './request-logging.js';
export {
  errorHandler,
  createErrorHandler,
  registerErrorHandler,
  buildErrorLogContext,
  type ErrorResponseBody,
  type ErrorLogContext,
  type ErrorHandlerObservers,
  type ServerErrorEvent,
  type AuthFailureEvent,
  type RateLimitEvent,
} from './error-handler.js';
export { createAuthenticationPreHandler, registerAuthentication } from './authentication.js';
export { createAuthorizeFactory, registerAuthorization, type AuthorizeFactory } from './authorization.js';
export {
  createRequireFeaturePreHandler,
  registerFeatureFlagAuthorization,
} from './feature-flag.js';
