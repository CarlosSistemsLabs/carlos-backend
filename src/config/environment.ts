import { z } from 'zod';

/**
 * Environment variable schema.
 *
 * Validates and normalizes process environment variables at startup so the rest
 * of the application can rely on strongly-typed configuration values.
 */
const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** PostgreSQL connection string consumed by Prisma. */
  DATABASE_URL: z.string().url(),
  /**
   * Maximum number of database connections held per service instance
   * (Requirement 31.3). Maps directly to Prisma's `connection_limit` query
   * parameter — Prisma manages a SINGLE pool with this hard upper bound and,
   * intentionally, does not expose a separate "max" API. Defaults to `20`, the
   * platform's per-instance ceiling; scale it down (not up) for constrained
   * deployments so the shared PostgreSQL server is not oversubscribed once
   * multiple instances run (Requirement 26.3 horizontal scaling).
   */
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(20),
  /**
   * Target MINIMUM number of warm connections the pool should aim to keep open
   * (advisory, default `5`). IMPORTANT: Prisma's connection pool does NOT
   * natively support a hard minimum / a fixed set of always-open connections —
   * it opens connections lazily up to {@link DATABASE_POOL_SIZE} and reaps idle
   * ones. This value is therefore recorded for documentation/observability and
   * as the target for an optional warmup, NOT faked as a Prisma setting. See
   * {@link import('@infrastructure/database/prisma-config.js').resolvePoolConfig}.
   */
  DATABASE_POOL_MIN: z.coerce.number().int().nonnegative().default(5),
  /** Seconds Prisma waits for a free connection before timing out. */
  DATABASE_POOL_TIMEOUT: z.coerce.number().int().nonnegative().default(10),

  /**
   * Comma-separated whitelist of allowed CORS origins
   * (e.g. `https://app.carlos-erp.com,https://carlos-erp.com`).
   * An empty value disables cross-origin requests (no origin is allowed).
   */
  CORS_ORIGIN: z.string().default(''),

  /** Maximum requests allowed within {@link RATE_LIMIT_WINDOW_MS} per key. */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  /** Rate-limit window length in milliseconds (default 60s). */
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  /**
   * Enables CSRF protection for state-changing requests. Defaults to `false`
   * because the platform's primary auth is stateless JWT carried in the
   * `Authorization` header (not cookies), which is not susceptible to CSRF.
   * Enable this only when cookie-based sessions are introduced.
   */
  CSRF_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),

  /** HSTS max-age in seconds advertised by the Helmet middleware (default 1 year). */
  HSTS_MAX_AGE: z.coerce.number().int().nonnegative().default(31_536_000),

  /**
   * Exposes the unauthenticated `GET /metrics` scrape endpoint (task 31.3,
   * Requirement 21.6). Defaults to `true`. The endpoint reports only
   * operational aggregates (no tenant data/PII) but MUST be network-restricted
   * in production (scraped internally). Set to `false` to disable it entirely
   * where it cannot be network-isolated.
   */
  METRICS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  /**
   * RS256 PEM-encoded private key used to sign access tokens (Requirement 8.1).
   * Optional in development/test so an ephemeral keypair can be generated for
   * local runs; required in production (enforced by {@link loadEnvironment}).
   * Supports `\n`-escaped single-line values (common in env managers).
   */
  JWT_PRIVATE_KEY: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value.replace(/\\n/g, '\n'))),
  /** RS256 PEM-encoded public key used to verify access tokens. */
  JWT_PUBLIC_KEY: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : value.replace(/\\n/g, '\n'))),
  /** Access-token lifetime (e.g. `15m`, `900s`). Defaults to 15 minutes. */
  JWT_ACCESS_TTL: z.string().default('15m'),
  /** Refresh-token lifetime (e.g. `7d`, `168h`). Defaults to 7 days. */
  JWT_REFRESH_TTL: z.string().default('7d'),
  /** `iss` claim stamped on issued access tokens and required on verify. */
  JWT_ISSUER: z.string().default('carlos-erp'),

  /**
   * Firebase Admin SDK integration (task 33.1, Requirements 13.5 & 14.2).
   *
   * All three are OPTIONAL: when no service-account credentials are provided the
   * backend runs with Firebase DISABLED (a no-op client), so local development
   * and tests never require a real project. Environment separation
   * (Requirement 14.2) is achieved simply by pointing each deployment's
   * credentials/project id at a DIFFERENT Firebase project — the TEST
   * deployment sets its TEST project's values, PRODUCTION sets its own.
   *
   * Credential resolution order: {@link FIREBASE_SERVICE_ACCOUNT} (a JSON string,
   * convenient for secret managers) takes precedence over
   * {@link FIREBASE_SERVICE_ACCOUNT_PATH} (a file path to the service-account
   * JSON). {@link FIREBASE_PROJECT_ID} overrides the `project_id` embedded in the
   * service account when set.
   */
  FIREBASE_PROJECT_ID: z.string().optional(),
  /** Service-account credentials as a raw JSON string (takes precedence over the path). */
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  /** Filesystem path to the service-account JSON file. */
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().optional(),

  /**
   * Field-level encryption key for reversible secrets AT REST (task 43.3,
   * Requirements 17.9 & 17.10) — e.g. stored third-party API credentials/tokens
   * and plugin integration secrets. NOT for passwords, which are one-way hashed
   * with bcrypt in the Auth module.
   *
   * A 32-byte (AES-256) key encoded as 64 hex chars or 44-char base64, with an
   * OPTIONAL `version:` prefix to seed key rotation (e.g. `k2:<base64>`).
   * OPTIONAL: when absent the field encryptor runs in a clearly-flagged
   * disabled (pass-through) mode with a loud warning — a throwaway key is
   * deliberately NOT generated because it would make persisted ciphertext
   * unreadable after a restart. Set this in every real deployment. See
   * {@link import('@infrastructure/crypto/index.js').buildFieldEncryptor}.
   */
  FIELD_ENCRYPTION_KEY: z.string().optional(),

  /**
   * Redis integration for distributed caching and stateless-backend session
   * storage (task 39.1, Requirement 31.2).
   *
   * All Redis settings are OPTIONAL: when {@link REDIS_URL} is absent the backend
   * degrades to an in-process cache / in-memory session store, so local
   * development and the test suite run WITHOUT a Redis server — the state of the
   * current environment (where the `redis` client package cannot even be
   * installed). When {@link REDIS_URL} is present the cache and session store are
   * backed by Redis and connect LAZILY on first use, never at boot.
   *
   * Environment separation (Requirement 14.2 style) is achieved purely through
   * env: the TEST deployment points {@link REDIS_URL} at its own Redis instance
   * and PRODUCTION points at a separate one — no code branches on `NODE_ENV`.
   */
  REDIS_URL: z.string().optional(),
  /**
   * Enables TLS (`rediss://`) for the Redis connection. Defaults to `false`.
   * Only consulted on the enabled path (when {@link REDIS_URL} is set); managed
   * Redis providers that require TLS set this to `true`.
   */
  REDIS_TLS: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  /**
   * Optional key prefix (e.g. `carlos:test:`) applied to every cache/session key
   * written to Redis. Lets multiple logical environments safely share one Redis
   * instance without key collisions. Applied by the cache/session layers, not by
   * the client.
   */
  REDIS_KEY_PREFIX: z.string().optional(),

  /**
   * Critical error-rate alerting (task 31.4, Requirement 21.7). The error
   * handler feeds each `5xx` into a rolling-window monitor; when
   * {@link ERROR_ALERT_THRESHOLD} server errors occur within
   * {@link ERROR_ALERT_WINDOW_MS} an alert is raised via the alert notifier.
   * {@link ERROR_ALERT_COOLDOWN_MS} suppresses repeat alerts during a sustained
   * incident (anti-alert-storm). Defaults: 10 errors / 60s, 5-minute cooldown.
   */
  ERROR_ALERT_THRESHOLD: z.coerce.number().int().positive().default(10),
  ERROR_ALERT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  ERROR_ALERT_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(300_000),

  /**
   * Suspicious-activity detection (task 31.4, Requirement 17.8). A rolling-window
   * detector fed by repeated failed logins / account lockouts (via the auth
   * event logger) and 401/403 bursts (via the error handler). When
   * {@link SUSPICIOUS_ACTIVITY_THRESHOLD} signals for the same key occur within
   * {@link SUSPICIOUS_ACTIVITY_WINDOW_MS} an alert is raised; the per-key
   * {@link SUSPICIOUS_ACTIVITY_COOLDOWN_MS} caps the alert rate. Defaults:
   * 5 signals / 5 minutes, 5-minute cooldown (satisfies "alert within 5 min").
   */
  SUSPICIOUS_ACTIVITY_THRESHOLD: z.coerce.number().int().positive().default(5),
  SUSPICIOUS_ACTIVITY_WINDOW_MS: z.coerce.number().int().positive().default(300_000),
  SUSPICIOUS_ACTIVITY_COOLDOWN_MS: z.coerce.number().int().nonnegative().default(300_000),

  /**
   * Google Places API key for the address autocomplete/geocode endpoints
   * (addresses module). OPTIONAL: when absent the addresses provider falls back
   * to a deterministic stub (sample Argentine localities), so the endpoints and
   * the mobile address-validation flow work in every environment without a key.
   * Set it per deployment to switch to real Google Places data.
   */
  GOOGLE_PLACES_API_KEY: z.string().optional(),
});

export type Environment = z.infer<typeof environmentSchema>;

/**
 * Parses and validates the current process environment.
 * Throws a descriptive error if any required variable is missing or invalid.
 */
export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  // Fail fast in production when the RS256 signing material is absent. Outside
  // production an ephemeral keypair is generated by the token service so local
  // and test runs work without managing real keys (Requirement 8.1).
  if (result.data.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (result.data.JWT_PRIVATE_KEY === undefined) {
      missing.push('JWT_PRIVATE_KEY');
    }
    if (result.data.JWT_PUBLIC_KEY === undefined) {
      missing.push('JWT_PUBLIC_KEY');
    }
    if (missing.length > 0) {
      throw new Error(
        `Invalid environment configuration:\n${missing
          .map((key) => `  - ${key}: required in production`)
          .join('\n')}`,
      );
    }
  }

  return result.data;
}

export const env = loadEnvironment();
