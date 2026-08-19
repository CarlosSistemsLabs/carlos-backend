import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodIssue } from 'zod';
import { getTenantId, getUserId } from '@common/context';
import { type ICrashReporter, NoopCrashReporter } from '@common/crash-reporting';
import { DomainError, ErrorCode, serializeError } from '@domain/errors';

/**
 * Consistent error response envelope returned for every failed request.
 *
 * Shape mandated by Requirement 25.4: `error_code`, `message`, `details`,
 * `timestamp`, `request_id`.
 */
export interface ErrorResponseBody {
  error_code: string;
  message: string;
  details?: unknown;
  timestamp: string;
  request_id: string;
}

/** A single field-level validation problem surfaced to API clients. */
interface FieldError {
  field: string;
  message: string;
}

/**
 * Structured server-side error-log context (task 31.4, Requirement 21.5).
 *
 * Every `5xx`/unhandled error logs the full stack trace plus the request
 * correlation identifiers (`request_id`, `tenant_id`, `user_id` — the last two
 * read from the async request context) and the HTTP `method`/`path`, so an
 * operator can reconstruct exactly what failed and for whom. The secret
 * redaction configured on the logger (task 31.1) still applies to these fields.
 * This context is NEVER sent to the client — the response stays the sanitized
 * {@link ErrorResponseBody}.
 */
export interface ErrorLogContext {
  request_id: string;
  method: string;
  path: string;
  error_name: string;
  error_message: string;
  tenant_id?: string;
  user_id?: string;
  stack?: string;
}

/**
 * Observers notified as errors are handled, so cross-cutting monitors can react
 * without the error handler depending on them concretely (task 31.4).
 *
 * - {@link onServerError} fires for every `5xx`/unhandled error — feeds the
 *   critical error-rate monitor (Requirement 21.7).
 * - {@link onAuthFailure} fires for every `401`/`403` — feeds the
 *   suspicious-activity detector for authorization-failure bursts
 *   (Requirement 17.8).
 * - {@link onRateLimit} fires for every `429` (rate-limit hit) — feeds the
 *   suspicious-activity detector and the security-audit log so throttling is
 *   recorded as suspicious activity (task 43.4, Requirement 17.8).
 *
 * All are optional; when omitted the error handler behaves exactly as before.
 */
export interface ErrorHandlerObservers {
  onServerError?: (info: ServerErrorEvent) => void;
  onAuthFailure?: (info: AuthFailureEvent) => void;
  onRateLimit?: (info: RateLimitEvent) => void;
}

/** Non-sensitive descriptor of a handled `5xx` error. */
export interface ServerErrorEvent {
  statusCode: number;
  method: string;
  path: string;
  requestId: string;
}

/** Non-sensitive descriptor of a handled `401`/`403` failure. */
export interface AuthFailureEvent {
  statusCode: number;
  method: string;
  path: string;
  requestId: string;
  ipAddress: string;
  userId?: string;
}

/** Non-sensitive descriptor of a handled `429` rate-limit hit. */
export interface RateLimitEvent {
  statusCode: number;
  method: string;
  path: string;
  requestId: string;
  ipAddress: string;
  userId?: string;
}

/**
 * Resolves the client's preferred locale for user-facing error messages
 * (Requirement 27.1) from the standard `Accept-Language` request header.
 *
 * Returns the raw header value (a BCP-47 tag or a weighted list such as
 * `es-AR,es;q=0.9,en;q=0.8`); the domain i18n layer normalizes/negotiates it
 * against the supported locales. Returns `undefined` when no header is present,
 * so the serializer keeps its default (non-localized) behavior and the wire
 * contract is unchanged for clients that do not negotiate a language.
 */
function resolveRequestLocale(request: FastifyRequest): string | undefined {
  const header = request.headers?.['accept-language'];
  if (Array.isArray(header)) {
    return header[0];
  }
  return header;
}

/** Maps Zod issues to a stable, client-friendly field-level structure. */
function toFieldErrors(issues: ZodIssue[]): FieldError[] {
  return issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
}

/** Builds the response envelope, omitting `details` when there is none. */
function buildBody(
  requestId: string,
  errorCode: string,
  message: string,
  details?: unknown,
): ErrorResponseBody {
  const base: ErrorResponseBody = {
    error_code: errorCode,
    message,
    timestamp: new Date().toISOString(),
    request_id: requestId,
  };
  return details === undefined ? base : { ...base, details };
}

/**
 * Builds the structured server-side log context for an error (Requirement 21.5).
 *
 * Includes the stack trace and — read from the async request context — the
 * tenant and user identifiers, so 5xx logs carry full "who/what/where" detail.
 * Optional fields are only present when known (satisfies
 * `exactOptionalPropertyTypes`).
 */
export function buildErrorLogContext(error: Error, request: FastifyRequest): ErrorLogContext {
  const context: ErrorLogContext = {
    request_id: request.id,
    method: request.method,
    path: request.url,
    error_name: error.name,
    error_message: error.message,
  };

  const tenantId = getTenantId();
  if (tenantId !== undefined) {
    context.tenant_id = tenantId;
  }
  const userId = getUserId();
  if (userId !== undefined) {
    context.user_id = userId;
  }
  if (typeof error.stack === 'string') {
    context.stack = error.stack;
  }

  return context;
}

/** Emits the {@link ErrorHandlerObservers.onAuthFailure} event for a 401/403. */
function notifyAuthFailure(
  observers: ErrorHandlerObservers,
  request: FastifyRequest,
  statusCode: number,
): void {
  if (observers.onAuthFailure === undefined) {
    return;
  }
  const info: AuthFailureEvent = {
    statusCode,
    method: request.method,
    path: request.url,
    requestId: request.id,
    ipAddress: request.ip,
  };
  const userId = getUserId();
  if (userId !== undefined) {
    info.userId = userId;
  }
  observers.onAuthFailure(info);
}

/** Emits the {@link ErrorHandlerObservers.onRateLimit} event for a 429. */
function notifyRateLimit(
  observers: ErrorHandlerObservers,
  request: FastifyRequest,
  statusCode: number,
): void {
  if (observers.onRateLimit === undefined) {
    return;
  }
  const info: RateLimitEvent = {
    statusCode,
    method: request.method,
    path: request.url,
    requestId: request.id,
    ipAddress: request.ip,
  };
  const userId = getUserId();
  if (userId !== undefined) {
    info.userId = userId;
  }
  observers.onRateLimit(info);
}

/** Emits the {@link ErrorHandlerObservers.onServerError} event for a 5xx. */
function notifyServerError(
  observers: ErrorHandlerObservers,
  request: FastifyRequest,
  statusCode: number,
): void {
  observers.onServerError?.({
    statusCode,
    method: request.method,
    path: request.url,
    requestId: request.id,
  });
}

/**
 * Forwards a 5xx/unknown error to the external crash-reporting seam (task 33.3,
 * Requirements 13.6/21.8).
 *
 * This is DISTINCT from the local `error`-level log line the handler already
 * emits (`buildErrorLogContext`): that line is the operator's local record,
 * while the crash reporter is the canonical "report to an external crash
 * service" path (structured `event:'error_report'` line today; Sentry/etc.
 * later). The report is enriched from the request context (tenant/user/request)
 * by the reporter itself; here we add the `feature` (matched route pattern or
 * URL) and `module` (HTTP method) dimensions Requirement 13.6 asks for. The
 * reporter never throws, so this is always safe on the error path. Fires only
 * for 5xx — 4xx client errors are never reported as crashes.
 */
function reportServerCrash(
  crashReporter: ICrashReporter,
  error: Error,
  request: FastifyRequest,
): void {
  const feature =
    typeof request.routeOptions?.url === 'string' ? request.routeOptions.url : request.url;
  crashReporter.reportError(error, { feature, module: request.method });
}

/**
 * Builds the centralized Fastify error handler.
 *
 * Translates errors into the consistent response envelope while keeping the
 * domain layer free of transport concerns:
 * - {@link DomainError} subclasses map to their declared `httpStatus`/`code`.
 * - {@link ZodError} (and Fastify schema validation) map to 422/400 with
 *   field-level messages.
 * - Anything else becomes a 500 with a generic message.
 *
 * Server (`5xx`) and unknown errors are logged at `error` WITH the full stack
 * trace and request context (Requirement 21.5); client (`4xx`) errors are logged
 * at `warn` WITHOUT a stack. The stack/internal detail is NEVER leaked to the
 * client. Optional {@link ErrorHandlerObservers} are notified for 5xx and
 * 401/403 so alerting monitors can react (task 31.4).
 *
 * An optional {@link ICrashReporter} (task 33.3, Requirements 13.6/21.8) is
 * additionally invoked for every 5xx/unknown error to forward it to the external
 * crash-reporting seam (a structured `event:'error_report'` line by default).
 * This is complementary to — not a replacement for — the local `error` log line:
 * see {@link reportServerCrash}. Defaults to a {@link NoopCrashReporter} so
 * existing call sites/tests are unaffected. 4xx client errors are never reported
 * as crashes.
 */
export function createErrorHandler(
  observers: ErrorHandlerObservers = {},
  crashReporter: ICrashReporter = new NoopCrashReporter(),
): (error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => void {
  return function errorHandler(
    error: FastifyError | Error,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    const requestId = request.id;
    const locale = resolveRequestLocale(request);

    if (error instanceof DomainError) {
      if (error.httpStatus >= 500) {
        request.log.error(buildErrorLogContext(error, request), error.message);
        notifyServerError(observers, request, error.httpStatus);
        reportServerCrash(crashReporter, error, request);
      } else {
        request.log.warn(
          {
            request_id: requestId,
            method: request.method,
            path: request.url,
            error_name: error.name,
            code: error.code,
          },
          error.message,
        );
        if (error.httpStatus === 401 || error.httpStatus === 403) {
          notifyAuthFailure(observers, request, error.httpStatus);
        } else if (error.httpStatus === 429) {
          notifyRateLimit(observers, request, error.httpStatus);
        }
      }
      const serialized = serializeError(error, locale);
      void reply
        .status(error.httpStatus)
        .send(buildBody(requestId, serialized.code, serialized.message, serialized.details));
      return;
    }

    if (error instanceof ZodError) {
      const fields = toFieldErrors(error.issues);
      request.log.warn({ request_id: requestId, fields }, 'Request validation failed');
      void reply
        .status(422)
        .send(buildBody(requestId, ErrorCode.VALIDATION, 'Validation failed', { fields }));
      return;
    }

    // Fastify's built-in schema validation surfaces errors with a `validation`
    // array and a 400 status code.
    const fastifyError = error as FastifyError;
    if (fastifyError.validation !== undefined) {
      const fields = fastifyError.validation.map((issue) => ({
        field: issue.instancePath.replace(/^\//, '').replace(/\//g, '.'),
        message: issue.message ?? 'Invalid value',
      }));
      request.log.warn({ request_id: requestId, fields }, 'Request validation failed');
      void reply
        .status(400)
        .send(buildBody(requestId, ErrorCode.VALIDATION, 'Validation failed', { fields }));
      return;
    }

    // Framework / plugin errors (e.g. @fastify/csrf-protection, content-type,
    // not-found) carry an HTTP `statusCode` and a stable `code`. Honor them so
    // they map onto the consistent envelope instead of being masked as a 500.
    if (typeof fastifyError.statusCode === 'number' && fastifyError.statusCode >= 400) {
      const status = fastifyError.statusCode;
      const code = fastifyError.code ?? ErrorCode.INTERNAL;
      if (status >= 500) {
        request.log.error(buildErrorLogContext(error, request), error.message);
        notifyServerError(observers, request, status);
        reportServerCrash(crashReporter, error, request);
      } else {
        request.log.warn(
          { request_id: requestId, method: request.method, path: request.url, code },
          error.message,
        );
        if (status === 401 || status === 403) {
          notifyAuthFailure(observers, request, status);
        } else if (status === 429) {
          notifyRateLimit(observers, request, status);
        }
      }
      void reply.status(status).send(buildBody(requestId, code, error.message));
      return;
    }

    // Unknown error: log full detail server-side (stack + context), return a
    // sanitized 500 (Requirement 21.5 — stack is never sent to the client).
    request.log.error(buildErrorLogContext(error, request), 'Unhandled error');
    notifyServerError(observers, request, 500);
    reportServerCrash(crashReporter, error, request);
    const serialized = serializeError(error, locale);
    void reply.status(500).send(buildBody(requestId, serialized.code, serialized.message));
  };
}

/**
 * Default error handler with no observers — preserves the original behavior for
 * call sites (and tests) that do not wire alerting monitors.
 */
export const errorHandler = createErrorHandler();

/**
 * Registers the error handler as the application's error handler. Optional
 * {@link ErrorHandlerObservers} wire the alerting monitors (task 31.4) and an
 * optional {@link ICrashReporter} wires the external crash-reporting seam
 * (task 33.3); when both are omitted the default (observer-less, no-op-crash)
 * handler is installed.
 */
export function registerErrorHandler(
  app: FastifyInstance,
  observers?: ErrorHandlerObservers,
  crashReporter?: ICrashReporter,
): void {
  const handler =
    observers === undefined && crashReporter === undefined
      ? errorHandler
      : createErrorHandler(observers ?? {}, crashReporter ?? new NoopCrashReporter());
  app.setErrorHandler(handler);
}
