import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyHelmet from '@fastify/helmet';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import { env, type Environment } from '@config/environment';
import { getUserId } from '@common/context';
import { RateLimitError } from '@domain/errors';

/** HTTP methods that mutate state and therefore require CSRF protection. */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Parses the comma-separated `CORS_ORIGIN` env value into a normalized list of
 * allowed origins. Blank entries are dropped and surrounding whitespace trimmed.
 */
export function parseAllowedOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Registers the HTTP security middleware stack on the Fastify instance:
 *
 * - **@fastify/helmet** — secure response headers including a Content Security
 *   Policy, HSTS, `X-Frame-Options`, and friends (Requirement 17.2).
 * - **@fastify/cors** — restricts cross-origin requests to the env-driven
 *   whitelist (`CORS_ORIGIN`) with credentials enabled (Requirement 17.3).
 * - **@fastify/rate-limit** — 100 requests/minute per key by default, keyed by
 *   authenticated user id (from the request context) and falling back to the
 *   client IP for anonymous requests. Returns a 429 in the consistent error
 *   envelope. Both the ceiling and window are configurable via
 *   `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` (Requirement 17.1).
 * - **@fastify/csrf-protection** — protects state-changing operations
 *   (POST/PUT/PATCH/DELETE) when `CSRF_ENABLED=true`. The platform's primary
 *   auth is stateless JWT in the `Authorization` header, which is not
 *   susceptible to CSRF, so this is **disabled by default** and Bearer-token
 *   requests are always exempt. Enable it only once cookie-based sessions are
 *   introduced (Requirement 17.4).
 *
 * This is registered after the request-context hook so the rate limiter can
 * read the authenticated user id from the async-local context, and before the
 * feature routes so every route inherits the protections.
 */
export async function registerSecurity(
  app: FastifyInstance,
  config: Environment = env,
): Promise<void> {
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
      },
    },
    hsts: {
      maxAge: config.HSTS_MAX_AGE,
      includeSubDomains: true,
      preload: true,
    },
    frameguard: { action: 'deny' },
  });

  const allowedOrigins = parseAllowedOrigins(config.CORS_ORIGIN);
  await app.register(fastifyCors, {
    origin: (origin, callback) => {
      // Same-origin / non-browser clients (curl, server-to-server) send no
      // Origin header and are allowed through. Disallowed origins resolve to
      // `false` so the `Access-Control-Allow-Origin` header is withheld and the
      // browser blocks the response, without the server emitting a 500.
      const isAllowed = origin === undefined || allowedOrigins.includes(origin);
      callback(null, isAllowed);
    },
    credentials: true,
  });

  await app.register(fastifyRateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_WINDOW_MS,
    keyGenerator: (request) => getUserId() ?? request.ip,
    // The limiter throws the builder's return value; a RateLimitError is mapped
    // to the consistent 429 envelope by the central error handler.
    errorResponseBuilder: (_request, context) =>
      new RateLimitError('Rate limit exceeded. Please retry later.', {
        max: context.max,
        retry_after_ms: context.ttl,
      }),
  });

  if (config.CSRF_ENABLED) {
    await app.register(fastifyCookie);
    await app.register(fastifyCsrf, { cookieOpts: { signed: false } });

    // Runs at preHandler so cookies and the request body are already parsed,
    // allowing the CSRF token to be read from the body or headers.
    app.addHook('preHandler', (request: FastifyRequest, reply: FastifyReply, done) => {
      if (!STATE_CHANGING_METHODS.has(request.method)) {
        done();
        return;
      }
      // Stateless JWT requests authenticate via the Authorization header and are
      // not vulnerable to CSRF, so they are exempt from the token check.
      const authorization = request.headers.authorization;
      if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
        done();
        return;
      }
      // On a missing/invalid token the plugin sends a 403 response directly and
      // does not invoke `done`, short-circuiting the request.
      app.csrfProtection(request, reply, done);
    });
  }
}
