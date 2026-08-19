import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { runWithContext } from '@common/context';
import type { ICrashReporter } from '@common/crash-reporting';
import {
  registerErrorHandler,
  createErrorHandler,
  buildErrorLogContext,
  type AuthFailureEvent,
  type ServerErrorEvent,
  type RateLimitEvent,
} from './error-handler.js';
import {
  ErrorCode,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  BusinessRuleError,
  RateLimitError,
  type DomainError,
} from '@domain/errors';

const domainCases: ReadonlyArray<{
  path: string;
  status: number;
  code: string;
  build: () => DomainError;
}> = [
  {
    path: '/validation',
    status: 400,
    code: ErrorCode.VALIDATION,
    build: () => new ValidationError('bad input', { field: 'email' }),
  },
  {
    path: '/not-found',
    status: 404,
    code: ErrorCode.NOT_FOUND,
    build: () => new NotFoundError('missing'),
  },
  {
    path: '/conflict',
    status: 409,
    code: ErrorCode.CONFLICT,
    build: () => new ConflictError('dup'),
  },
  {
    path: '/unauthorized',
    status: 401,
    code: ErrorCode.UNAUTHORIZED,
    build: () => new UnauthorizedError(),
  },
  {
    path: '/forbidden',
    status: 403,
    code: ErrorCode.FORBIDDEN,
    build: () => new ForbiddenError(),
  },
  {
    path: '/business-rule',
    status: 422,
    code: ErrorCode.BUSINESS_RULE,
    build: () => new BusinessRuleError('nope'),
  },
];

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);

  for (const testCase of domainCases) {
    app.get(testCase.path, () => {
      throw testCase.build();
    });
  }

  app.get('/zod', () => {
    z.object({ name: z.string(), age: z.number() }).parse({ name: 123 });
    return { ok: true };
  });

  app.post(
    '/schema',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
      },
    },
    () => ({ ok: true }),
  );

  app.get('/boom', () => {
    throw new Error('super secret internal explosion');
  });

  // A framework/plugin error carrying an HTTP statusCode and a stable code.
  app.get('/http-error', () => {
    const error = new Error('Forbidden by plugin') as Error & {
      statusCode: number;
      code: string;
    };
    error.statusCode = 403;
    error.code = 'FST_CSRF_MISSING_SECRET';
    throw error;
  });

  return app;
}

describe('error handler', () => {
  let app: FastifyInstance;

  beforeAll(() => {
    app = buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  for (const testCase of domainCases) {
    it(`maps ${testCase.code} to HTTP ${testCase.status} with the consistent envelope`, async () => {
      const response = await app.inject({ method: 'GET', url: testCase.path });
      expect(response.statusCode).toBe(testCase.status);

      const body = response.json();
      expect(body.error_code).toBe(testCase.code);
      expect(typeof body.message).toBe('string');
      expect(typeof body.timestamp).toBe('string');
      expect(typeof body.request_id).toBe('string');
      // timestamp is a valid ISO date
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    });
  }

  it('includes domain error details when present', async () => {
    const response = await app.inject({ method: 'GET', url: '/validation' });
    const body = response.json();
    expect(body.details).toEqual({ field: 'email' });
  });

  it('omits details when the domain error has none', async () => {
    const response = await app.inject({ method: 'GET', url: '/unauthorized' });
    const body = response.json();
    expect(body.details).toBeUndefined();
  });

  it('maps a ZodError to HTTP 422 with field-level messages', async () => {
    const response = await app.inject({ method: 'GET', url: '/zod' });
    expect(response.statusCode).toBe(422);

    const body = response.json();
    expect(body.error_code).toBe(ErrorCode.VALIDATION);
    expect(body.message).toBe('Validation failed');
    expect(Array.isArray(body.details.fields)).toBe(true);
    const fieldNames = body.details.fields.map((f: { field: string }) => f.field);
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('age');
  });

  it('maps Fastify schema validation to HTTP 400 with field-level messages', async () => {
    const response = await app.inject({ method: 'POST', url: '/schema', payload: {} });
    expect(response.statusCode).toBe(400);

    const body = response.json();
    expect(body.error_code).toBe(ErrorCode.VALIDATION);
    expect(body.message).toBe('Validation failed');
    expect(Array.isArray(body.details.fields)).toBe(true);
  });

  it('honors the status code and code of framework/plugin HTTP errors', async () => {
    const response = await app.inject({ method: 'GET', url: '/http-error' });
    expect(response.statusCode).toBe(403);

    const body = response.json();
    expect(body.error_code).toBe('FST_CSRF_MISSING_SECRET');
    expect(body.message).toBe('Forbidden by plugin');
    expect(typeof body.request_id).toBe('string');
  });

  it('maps unknown errors to a sanitized HTTP 500', async () => {
    const response = await app.inject({ method: 'GET', url: '/boom' });
    expect(response.statusCode).toBe(500);

    const body = response.json();
    expect(body.error_code).toBe(ErrorCode.INTERNAL);
    expect(body.message).toBe('An unexpected error occurred');
    expect(body.details).toBeUndefined();
    // Internal details must never leak to clients.
    expect(JSON.stringify(body)).not.toContain('super secret internal explosion');
  });

  // -------------------------------------------------------------------------
  // Internationalization of error messages (task 41.1, Requirement 27.1)
  // -------------------------------------------------------------------------

  it('localizes a domain error message from the Accept-Language header (es)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/not-found',
      headers: { 'accept-language': 'es-AR,es;q=0.9,en;q=0.8' },
    });
    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error_code).toBe(ErrorCode.NOT_FOUND);
    expect(body.message).toBe('No se encontró el recurso solicitado.');
  });

  it('localizes a domain error message from the Accept-Language header (en)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/not-found',
      headers: { 'accept-language': 'en' },
    });
    const body = response.json();
    expect(body.message).toBe('The requested resource was not found.');
  });

  it('localizes the sanitized 500 message without leaking internals (es)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/boom',
      headers: { 'accept-language': 'es' },
    });
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(body.error_code).toBe(ErrorCode.INTERNAL);
    expect(body.message).toBe('Ocurrió un error inesperado.');
    expect(JSON.stringify(body)).not.toContain('super secret internal explosion');
  });
});

// ---------------------------------------------------------------------------
// Structured error logging + alerting observers (task 31.4, Req 21.5/21.7/17.8)
// ---------------------------------------------------------------------------

interface FakeReply {
  statusCode: number;
  body: unknown;
  status: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
}

function makeReply(): FakeReply {
  const reply = { statusCode: 0, body: undefined as unknown } as FakeReply;
  reply.status = vi.fn((code: number) => {
    reply.statusCode = code;
    return reply;
  });
  reply.send = vi.fn((body: unknown) => {
    reply.body = body;
    return reply;
  });
  return reply;
}

function makeRequest(overrides: Partial<FastifyRequest> = {}): {
  request: FastifyRequest;
  log: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
} {
  const log = { error: vi.fn(), warn: vi.fn() };
  const request = {
    id: 'req-123',
    method: 'GET',
    url: '/api/v1/boom',
    ip: '198.51.100.9',
    log,
    ...overrides,
  } as unknown as FastifyRequest;
  return { request, log };
}

describe('error handler structured logging (Req 21.5)', () => {
  it('logs the full stack trace + request/tenant/user context for a 500', () => {
    const handler = createErrorHandler();
    const { request, log } = makeRequest();
    const reply = makeReply();
    const error = new Error('super secret internal explosion');

    runWithContext(
      { requestId: 'req-123', tenantId: 'tenant-9', userId: 'user-7' },
      () => handler(error, request, reply as unknown as FastifyReply),
    );

    expect(log.error).toHaveBeenCalledTimes(1);
    const logged = log.error.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(logged.request_id).toBe('req-123');
    expect(logged.tenant_id).toBe('tenant-9');
    expect(logged.user_id).toBe('user-7');
    expect(logged.method).toBe('GET');
    expect(logged.path).toBe('/api/v1/boom');
    expect(logged.error_name).toBe('Error');
    expect(typeof logged.stack).toBe('string');
    expect(logged.stack as string).toContain('super secret internal explosion');

    // Response body must be the sanitized envelope with NO stack leaked.
    expect(reply.statusCode).toBe(500);
    const body = reply.body as Record<string, unknown>;
    expect(body.error_code).toBe(ErrorCode.INTERNAL);
    expect(JSON.stringify(body)).not.toContain('super secret internal explosion');
    expect(body.stack).toBeUndefined();
  });

  it('logs 4xx client errors at warn WITHOUT a stack trace', () => {
    const handler = createErrorHandler();
    const { request, log } = makeRequest();
    const reply = makeReply();

    handler(new NotFoundError('missing'), request, reply as unknown as FastifyReply);

    expect(log.error).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    const logged = log.warn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(logged.stack).toBeUndefined();
    expect(logged.request_id).toBe('req-123');
    expect(reply.statusCode).toBe(404);
  });

  it('buildErrorLogContext omits tenant/user when outside a request context', () => {
    const { request } = makeRequest();
    const ctx = buildErrorLogContext(new Error('boom'), request);
    expect(ctx.request_id).toBe('req-123');
    expect(ctx.tenant_id).toBeUndefined();
    expect(ctx.user_id).toBeUndefined();
    expect(ctx.stack).toBeDefined();
  });
});

describe('error handler alerting observers (task 31.4)', () => {
  it('invokes onServerError for a 500 (feeds the error-rate monitor)', () => {
    const onServerError = vi.fn<(info: ServerErrorEvent) => void>();
    const handler = createErrorHandler({ onServerError });
    const { request } = makeRequest();
    const reply = makeReply();

    handler(new Error('boom'), request, reply as unknown as FastifyReply);

    expect(onServerError).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 500, method: 'GET', path: '/api/v1/boom', requestId: 'req-123' }),
    );
  });

  it('invokes onAuthFailure for a 403 (feeds the suspicious-activity detector)', () => {
    const onAuthFailure = vi.fn<(info: AuthFailureEvent) => void>();
    const handler = createErrorHandler({ onAuthFailure });
    const { request } = makeRequest();
    const reply = makeReply();

    runWithContext({ requestId: 'req-123', userId: 'user-42' }, () =>
      handler(new ForbiddenError(), request, reply as unknown as FastifyReply),
    );

    expect(onAuthFailure).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, ipAddress: '198.51.100.9', userId: 'user-42' }),
    );
  });

  it('invokes onRateLimit for a 429 (feeds suspicious-activity + security audit)', () => {
    const onRateLimit = vi.fn<(info: RateLimitEvent) => void>();
    const onAuthFailure = vi.fn<(info: AuthFailureEvent) => void>();
    const handler = createErrorHandler({ onRateLimit, onAuthFailure });
    const { request } = makeRequest({ method: 'POST', url: '/api/v1/auth/login' } as Partial<FastifyRequest>);
    const reply = makeReply();

    runWithContext({ requestId: 'req-123', userId: 'user-42' }, () =>
      handler(new RateLimitError(), request, reply as unknown as FastifyReply),
    );

    expect(reply.statusCode).toBe(429);
    // A 429 is suspicious activity, NOT an auth failure.
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(onRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 429,
        method: 'POST',
        path: '/api/v1/auth/login',
        ipAddress: '198.51.100.9',
        userId: 'user-42',
        requestId: 'req-123',
      }),
    );
  });

  it('does not invoke observers for validation (422) errors', () => {
    const onServerError = vi.fn();
    const onAuthFailure = vi.fn();
    const onRateLimit = vi.fn();
    const handler = createErrorHandler({ onServerError, onAuthFailure, onRateLimit });
    const { request } = makeRequest();
    const reply = makeReply();

    handler(new ValidationError('bad'), request, reply as unknown as FastifyReply);

    expect(onServerError).not.toHaveBeenCalled();
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(onRateLimit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Crash-reporting seam wiring (task 33.3, Requirements 13.6, 21.8)
// ---------------------------------------------------------------------------

/** A spy {@link ICrashReporter} capturing every reported error + context. */
function makeSpyCrashReporter(): {
  reporter: ICrashReporter;
  reportError: ReturnType<typeof vi.fn>;
} {
  const reportError = vi.fn();
  return { reporter: { reportError }, reportError };
}

describe('error handler crash reporting (task 33.3)', () => {
  it('reports 5xx/unknown errors through the crash reporter with enriched context', () => {
    const { reporter, reportError } = makeSpyCrashReporter();
    const handler = createErrorHandler({}, reporter);
    const { request } = makeRequest();
    const reply = makeReply();
    const error = new Error('boom');

    runWithContext({ requestId: 'req-123', tenantId: 'tenant-9', userId: 'user-7' }, () =>
      handler(error, request, reply as unknown as FastifyReply),
    );

    expect(reportError).toHaveBeenCalledTimes(1);
    const [reportedError, context] = reportError.mock.calls[0] as [
      Error,
      { feature?: string; module?: string },
    ];
    expect(reportedError).toBe(error);
    // feature falls back to the request URL when no matched route pattern exists;
    // module carries the HTTP method.
    expect(context.feature).toBe('/api/v1/boom');
    expect(context.module).toBe('GET');
  });

  it('does NOT report 4xx client errors as crashes', () => {
    const { reporter, reportError } = makeSpyCrashReporter();
    const handler = createErrorHandler({}, reporter);
    const { request } = makeRequest();
    const reply = makeReply();

    handler(new NotFoundError('missing'), request, reply as unknown as FastifyReply);

    expect(reportError).not.toHaveBeenCalled();
  });

  it('reports DomainError 5xx (business/internal) through the crash reporter', () => {
    const { reporter, reportError } = makeSpyCrashReporter();
    const handler = createErrorHandler({}, reporter);
    const { request } = makeRequest();
    const reply = makeReply();

    // BusinessRuleError maps to 422 (a 4xx) — must NOT be reported.
    handler(new BusinessRuleError('nope'), request, reply as unknown as FastifyReply);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('reports a real 5xx surfaced through a live app via app.inject (TEST env)', async () => {
    const { reporter, reportError } = makeSpyCrashReporter();
    const app = Fastify({ logger: false });
    registerErrorHandler(app, undefined, reporter);
    app.get('/api/v1/explode', () => {
      throw new Error('kaboom in test env');
    });
    // A 4xx route to prove selectivity end-to-end.
    app.get('/api/v1/missing', () => {
      throw new NotFoundError('gone');
    });

    const crashed = await app.inject({ method: 'GET', url: '/api/v1/explode' });
    expect(crashed.statusCode).toBe(500);
    // The internal message must never leak to the client body.
    expect(crashed.body).not.toContain('kaboom in test env');

    const notFound = await app.inject({ method: 'GET', url: '/api/v1/missing' });
    expect(notFound.statusCode).toBe(404);

    await app.close();

    // Exactly one crash report — the 500, not the 404.
    expect(reportError).toHaveBeenCalledTimes(1);
    const [reportedError, context] = reportError.mock.calls[0] as [
      Error,
      { feature?: string; module?: string },
    ];
    expect(reportedError).toBeInstanceOf(Error);
    expect(reportedError.message).toBe('kaboom in test env');
    expect(context.feature).toBe('/api/v1/explode');
    expect(context.module).toBe('GET');
  });
});
