import type { LoggerOptions } from 'pino';
import { getRequestId, getTenantId, getUserId } from '@common/context';
import type { Environment } from '@config/environment';

/**
 * Structured logging configuration (Requirement 21.1, 21.2, 21.5).
 *
 * The application logs newline-delimited JSON to stdout. In a containerized
 * deployment (Railway) stdout is captured by the platform, which owns log
 * rotation and retention — see {@link LOG_RETENTION} and the module notes at the
 * bottom of this file. The functions here build the Pino options object that
 * Fastify uses to construct its logger; we never instantiate Pino directly so
 * Fastify remains the single owner of the logger instance.
 */

/** Correlation fields injected into every log line when inside a request scope. */
export interface ContextLogFields {
  request_id?: string;
  tenant_id?: string;
  user_id?: string;
}

/**
 * Object paths redacted from every log line before serialization
 * (Requirement 21.5 — never leak secrets). Covers both top-level fields and the
 * common nested shapes (request payloads under `*.` and HTTP headers under
 * `req.headers`/`headers`). Redacted values are removed entirely rather than
 * masked so no trace of the secret survives in the log stream.
 */
export const REDACTED_PATHS: readonly string[] = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
];

/**
 * Default log level per environment when `LOG_LEVEL` is not explicitly set.
 *
 * - `development`: `debug` for rich local feedback.
 * - `test`: `silent` to keep the test runner output clean.
 * - `production`: `info` (Requirement — info in production, debug in lower envs).
 */
const DEFAULT_LEVEL_BY_ENV: Record<Environment['NODE_ENV'], Environment['LOG_LEVEL']> = {
  development: 'debug',
  test: 'silent',
  production: 'info',
};

export interface ResolveLogLevelInput {
  nodeEnv: Environment['NODE_ENV'];
  /**
   * Explicit `LOG_LEVEL` override. When provided it always wins; when
   * `undefined` the level is derived from {@link nodeEnv}.
   */
  explicitLevel?: Environment['LOG_LEVEL'] | undefined;
}

/**
 * Resolves the effective log level: an explicit `LOG_LEVEL` override takes
 * precedence, otherwise the per-environment default is used.
 */
export function resolveLogLevel({
  nodeEnv,
  explicitLevel,
}: ResolveLogLevelInput): Environment['LOG_LEVEL'] {
  return explicitLevel ?? DEFAULT_LEVEL_BY_ENV[nodeEnv];
}

/**
 * Pino `mixin` that injects the request correlation identifiers into every log
 * line automatically (Requirement 21.2). Reads `request_id`/`tenant_id`/
 * `user_id` from the AsyncLocalStorage request context so ad-hoc `app.log`/
 * `request.log` calls carry the correlation fields without threading them
 * through every call site.
 *
 * Outside a request scope (startup, background tasks) the fields are absent from
 * the context and are therefore omitted from the log line rather than emitted as
 * `null`.
 */
export function contextMixin(): ContextLogFields {
  const fields: ContextLogFields = {};

  const requestId = getRequestId();
  if (requestId !== undefined) {
    fields.request_id = requestId;
  }

  const tenantId = getTenantId();
  if (tenantId !== undefined) {
    fields.tenant_id = tenantId;
  }

  const userId = getUserId();
  if (userId !== undefined) {
    fields.user_id = userId;
  }

  return fields;
}

/**
 * Builds the Pino logger options consumed by Fastify (see `@config/server`).
 *
 * Configures (Requirement 21.1/21.2/21.5):
 * - JSON output with an ISO-8601 `timestamp` field and a `level` label string.
 * - A `service` base field for downstream log routing.
 * - Redaction of sensitive fields (see {@link REDACTED_PATHS}).
 * - The context {@link contextMixin} so correlation ids appear on every line.
 * - The effective level from {@link resolveLogLevel}: an explicit `LOG_LEVEL`
 *   (detected from the raw environment) overrides the per-`NODE_ENV` default.
 *
 * Pretty-printing is intentionally NOT configured: the app always emits JSON and
 * does not depend on `pino-pretty`. Pretty formatting is optional dev tooling
 * (pipe stdout through `pino-pretty` locally) and is never a runtime dependency.
 */
export function buildLoggerOptions(
  env: Environment,
  rawEnv: NodeJS.ProcessEnv = process.env,
): LoggerOptions {
  // The Zod schema defaults LOG_LEVEL to `info`, so the parsed value alone
  // cannot distinguish "explicitly set" from "defaulted". Inspect the raw
  // environment: only treat LOG_LEVEL as an override when it is actually present.
  const explicitLevel =
    rawEnv.LOG_LEVEL !== undefined && rawEnv.LOG_LEVEL !== '' ? env.LOG_LEVEL : undefined;

  return {
    level: resolveLogLevel({ nodeEnv: env.NODE_ENV, explicitLevel }),
    // ISO-8601 timestamp under the `timestamp` key (Requirement 21.2).
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    formatters: {
      // Emit the level as its label (e.g. "info") rather than the numeric value.
      level: (label) => ({ level: label }),
    },
    base: { service: 'carlos-backend' },
    redact: {
      paths: [...REDACTED_PATHS],
      remove: true,
    },
    mixin: contextMixin,
  };
}

/**
 * Target log retention for the platform-managed log store (Requirement 21.5).
 *
 * Log rotation and retention are NOT performed in-process. Following 12-factor
 * app principles the service writes its JSON event stream to stdout; the
 * container platform (Railway) collects, rotates, and retains it. This constant
 * documents the retention target the platform log drain should be configured for
 * and is referenced by infrastructure/runbook documentation.
 */
export const LOG_RETENTION = {
  /** Days of logs the platform log drain should retain. */
  retentionDays: 30,
  /** The app streams JSON to stdout; the platform owns rotation. */
  destination: 'stdout' as const,
} as const;
