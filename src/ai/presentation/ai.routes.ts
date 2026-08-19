import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { INFRASTRUCTURE_TOKENS } from '@infrastructure/di/index.js';
import { FEATURES } from '@modules/subscriptions/index.js';
import { validateBody } from '@presentation/validators/index.js';
import { isDegradableError, withFallback, type DegradationLogger } from '@common/resilience/index.js';
import type { IOperationAwareAIService } from '../resilient-ai-service.js';
import {
  NaturalLanguageQueryService,
  ReportGenerationService,
  SalesAssistantService,
} from '../ai-capabilities.js';
import type {
  AIRequestContext,
  NaturalLanguageQueryResponse,
  ReportGenerationResponse,
  SalesAssistantMessage,
  SalesAssistantResponse,
} from '../ai-service.js';
import {
  naturalLanguageQueryBodySchema,
  reportGenerateBodySchema,
  salesAssistantBodySchema,
  naturalLanguageQueryRouteSchema,
  reportGenerateRouteSchema,
  salesAssistantRouteSchema,
} from './ai.schemas.js';

/**
 * The feature key gating the AI Integration endpoints.
 *
 * The AI features (sales assistant, natural-language query, AI report
 * generation) are an ENTERPRISE-tier capability (Requirement 20.1). The
 * canonical plan → feature matrix grants the dedicated `ai` feature to the
 * Enterprise plan ONLY, so a tenant on Starter/Business (or with no active
 * subscription) is refused with a 403 by the subscription/feature guard.
 */
const AI_FEATURE = FEATURES.AI;

/**
 * The capability services built over the resilient {@link IOperationAwareAIService}.
 */
interface AiUseCases {
  salesAssistant: SalesAssistantService;
  query: NaturalLanguageQueryService;
  reports: ReportGenerationService;
}

/**
 * The extra flags stamped onto an AI response when it is a GRACEFUL-DEGRADATION
 * fallback rather than a real model completion (Requirement 20.5).
 *
 * Clients render a friendly "temporarily unavailable" state off `degraded` /
 * `available` while still receiving a populated primary field (`reply` /
 * `answer` / `narrative`) carrying the human-readable message — so a client
 * that ignores the flags degrades to simply showing that message rather than
 * breaking on a missing field.
 */
interface DegradedFlags {
  /** Always `true` on a fallback body; absent/false on a real completion. */
  readonly degraded: true;
  /** Always `false` on a fallback body: the AI provider was not reachable. */
  readonly available: false;
}

/**
 * The user-facing message returned in the degraded body's primary text field.
 * Intentionally generic and reassuring — the AI enhancement is non-critical, so
 * the client shows this instead of an error banner (Requirement 20.5).
 */
const AI_UNAVAILABLE_MESSAGE =
  'The AI assistant is temporarily unavailable. Please try again in a moment.';

/** Builds the degraded sales-assistant body (200, `degraded: true`). */
function degradedSalesAssistant(): SalesAssistantResponse & DegradedFlags {
  return { reply: AI_UNAVAILABLE_MESSAGE, degraded: true, available: false };
}

/** Builds the degraded natural-language-query body (200, `degraded: true`). */
function degradedQuery(): NaturalLanguageQueryResponse & DegradedFlags {
  return { answer: AI_UNAVAILABLE_MESSAGE, degraded: true, available: false };
}

/** Builds the degraded report-generation body (200, `degraded: true`). */
function degradedReport(): ReportGenerationResponse & DegradedFlags {
  return { narrative: AI_UNAVAILABLE_MESSAGE, degraded: true, available: false };
}

/**
 * Resolves the resilient AI service from the composition container and
 * constructs the capability services over it.
 *
 * The base {@link INFRASTRUCTURE_TOKENS.AIService} is bound to a
 * {@link import('../resilient-ai-service.js').ResilientAIService}, which is an
 * {@link IOperationAwareAIService}; the capability services require the
 * operation-aware surface so each runs under its per-operation timeout budget
 * (Requirement 20.4). The default composition configures it with NO providers,
 * so `isEnabled()` is `false` and every completion throws `AIUnavailableError`
 * (→ 503) until concrete provider adapters are bound (Requirement 20.5).
 */
export function buildAiUseCases(container: Container): AiUseCases {
  const ai = container.resolve(INFRASTRUCTURE_TOKENS.AIService) as IOperationAwareAIService;
  return {
    salesAssistant: new SalesAssistantService(ai),
    query: new NaturalLanguageQueryService(ai),
    reports: new ReportGenerationService(ai),
  };
}

/**
 * Builds the tenant-scoped {@link AIRequestContext} from the authenticated
 * request.
 *
 * Defence in depth: every AI route attaches `app.authenticate`, which populates
 * `request.auth`; should that be bypassed the handler still refuses with a 401
 * rather than calling the AI service without a tenant scope (Requirement 20.3).
 * The `tenantId`/`userId` come from the verified token — never from the client
 * body — and `requestId` is the correlation id for cost-tracking logs
 * (Requirement 20.6).
 */
function requireAiContext(request: FastifyRequest): AIRequestContext {
  const auth = request.auth;
  if (auth === undefined) {
    throw new UnauthorizedError('Authentication required');
  }
  return {
    tenantId: auth.tenantId,
    ...(auth.userId !== undefined ? { userId: auth.userId } : {}),
    requestId: request.id,
  };
}

/** Options accepted by the {@link aiRoutesPlugin}. */
export interface AiRoutesOptions {
  /** Composition container with the AI infrastructure registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the AI Integration endpoints under `/api/v1/ai`.
 *
 * Every route is protected: `app.authenticate` verifies the bearer token
 * (401 on failure), `app.requireFeature(FEATURES.AI)` enforces the
 * subscription/feature guard (403 when the tenant's plan does not grant the
 * Enterprise-only `ai` feature) and `app.authorize('ai', screen, action)`
 * enforces RBAC (403 when the role lacks the permission). Request bodies are
 * validated with Zod via the shared validators; validation failures map to the
 * consistent 400 envelope through the central error handler.
 *
 * Graceful degradation (Requirement 20.5, task 41.4): the AI enhancements are a
 * NON-CRITICAL feature, so when the provider is unavailable or slow the endpoint
 * degrades gracefully instead of failing the request. Each handler runs the
 * capability call through {@link withFallback}: when it throws an
 * `AIUnavailableError` / `AITimeoutError` (or a `CircuitOpenError` from the
 * breaker) — the transient errors matched by {@link isDegradableError} — the
 * endpoint returns a friendly **200** body flagged `degraded: true` /
 * `available: false` (carrying a reassuring message in the primary text field)
 * rather than a hard 503/504. This lets clients render a "try again later" state
 * seamlessly. Crucially, only those transient errors degrade: authentication
 * (401), the Enterprise feature gate and RBAC (403) and request validation (400)
 * all run BEFORE/OUTSIDE the fallback and still surface unchanged, so a real
 * client error is never masked as a degraded success.
 *
 * The attached `schema` objects document the routes for OpenAPI (Requirement
 * 3.7); Fastify's own validation is disabled inside this encapsulated plugin so
 * it never short-circuits the Zod checks.
 */
export const aiRoutesPlugin: FastifyPluginAsync<AiRoutesOptions> = (app, opts) => {
  const useCases = buildAiUseCases(opts.container);

  // Structured degradation log sink: adapt the resilience DegradationLogger onto
  // the Fastify/pino logger so each degraded fallback emits an `event: 'degraded'`
  // line for observability without coupling the resilience layer to pino.
  const degradationLogger: DegradationLogger = {
    info: (message, meta): void => {
      app.log.info(meta ?? {}, message);
    },
  };

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // POST /api/v1/ai/sales-assistant — conversational sales assistance
  app.post(
    '/sales-assistant',
    {
      schema: salesAssistantRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(AI_FEATURE),
        app.authorize('ai', 'assistant', 'write'),
      ],
    },
    async (request, reply) => {
      const context = requireAiContext(request);
      const body = validateBody(request, salesAssistantBodySchema);
      const history: SalesAssistantMessage[] | undefined = body.history?.map((turn) => ({
        role: turn.role,
        content: turn.content,
      }));
      const result = await withFallback(
        () =>
          useCases.salesAssistant.chat({
            context,
            message: body.message,
            ...(history !== undefined ? { history } : {}),
          }),
        degradedSalesAssistant,
        { feature: 'ai:sales-assistant', shouldDegrade: isDegradableError, logger: degradationLogger },
      );
      return reply.status(200).send(result);
    },
  );

  // POST /api/v1/ai/query — natural-language query over tenant data
  app.post(
    '/query',
    {
      schema: naturalLanguageQueryRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(AI_FEATURE),
        app.authorize('ai', 'query', 'read'),
      ],
    },
    async (request, reply) => {
      const context = requireAiContext(request);
      const body = validateBody(request, naturalLanguageQueryBodySchema);
      const result = await withFallback(
        () => useCases.query.ask({ context, question: body.question }),
        degradedQuery,
        { feature: 'ai:query', shouldDegrade: isDegradableError, logger: degradationLogger },
      );
      return reply.status(200).send(result);
    },
  );

  // POST /api/v1/ai/report-generate — AI-powered report generation
  app.post(
    '/report-generate',
    {
      schema: reportGenerateRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(AI_FEATURE),
        app.authorize('ai', 'reports', 'write'),
      ],
    },
    async (request, reply) => {
      const context = requireAiContext(request);
      const body = validateBody(request, reportGenerateBodySchema);
      const result = await withFallback(
        () =>
          useCases.reports.generateReport({
            context,
            prompt: body.prompt,
            ...(body.reportType !== undefined ? { reportType: body.reportType } : {}),
            ...(body.data !== undefined ? { data: body.data } : {}),
          }),
        degradedReport,
        { feature: 'ai:report-generate', shouldDegrade: isDegradableError, logger: degradationLogger },
      );
      return reply.status(200).send(result);
    },
  );

  return Promise.resolve();
};

/**
 * Registers the AI Integration routes under the `/api/v1/ai` prefix.
 *
 * Wraps {@link aiRoutesPlugin} in its own encapsulated context so the relaxed
 * validator compiler does not leak to other routes.
 */
export async function registerAiRoutes(app: FastifyInstance, container: Container): Promise<void> {
  await app.register(aiRoutesPlugin, { prefix: '/api/v1/ai', container });
}
