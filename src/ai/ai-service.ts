/**
 * AI Integration Layer — application-facing service contracts (task 37.1,
 * Requirements 20.1, 20.3, 20.4).
 *
 * ## What this module is
 * This module defines the BACKEND CAPABILITY PORTS for AI features: the app-
 * facing abstraction the application/use-case layer depends on to obtain sales
 * assistance, stock/demand prediction, natural-language querying, report
 * generation and automation suggestions (Requirement 20.1). It is
 * INTERFACE/CONTRACT-only preparation — no vendor SDK is imported, no network
 * call is made, and the domain layer takes no dependency on any LLM provider
 * (Requirement 20.3).
 *
 * ## Relationship to the Plugin System
 * The Plugin System already models the PLUGGABLE PROVIDERS: `AIPlugin`
 * (complete/analyze) in `src/plugins/plugin.ts` and the concrete
 * `OpenAiIntegration` / `ClaudeIntegration` / `GeminiIntegration` seams in
 * `src/plugins/integrations/ai-integrations.ts`. Those are the low-level,
 * vendor-shaped adapters. {@link IAIService} sits ABOVE them: it is the
 * higher-level, business-capability port the application resolves, expressed in
 * domain vocabulary (a "sales assistant chat", a "stock prediction") rather than
 * a raw prompt completion. The resilient wrapper built in task 37.2 will
 * implement {@link IAIService} by composing one or more `AIPlugin` providers,
 * enforcing the per-operation {@link AITimeoutConfig}, degrading gracefully when
 * a provider is unavailable (Requirement 20.5) and recording {@link AITokenUsage}
 * for cost tracking (Requirement 20.6). This module intentionally does NOT
 * duplicate the plugin contracts — it references and will be composed over them.
 *
 * ## Timeouts as a first-class contract concern (Requirement 20.4)
 * Different AI operations have very different latency profiles, so the timeout
 * budget is modelled directly in the contract via {@link AIOperationKind} and
 * {@link AITimeoutConfig} (queries 10s, reports 30s, predictions 60s). Each
 * capability sub-interface declares its {@link AIOperationKind} so the resilient
 * wrapper (task 37.2) can select and enforce the correct timeout without any
 * call-site guesswork. Endpoints exposing these capabilities (task 37.3) are
 * gated to the Enterprise plan through the existing feature-access mechanism.
 */

/* -------------------------------------------------------------------------- */
/* Providers                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The LLM provider a request is (or was) served by (Requirement 20.2). Mirrors
 * the concrete plugin integrations (`OpenAiIntegration`, `ClaudeIntegration`,
 * `GeminiIntegration`); kept as a closed union so the resilient wrapper (task
 * 37.2) can route/failover between providers and attribute usage per provider.
 */
export type AIProviderKind = 'openai' | 'claude' | 'gemini';

/* -------------------------------------------------------------------------- */
/* Operation kinds + timeout configuration (Requirement 20.4)                 */
/* -------------------------------------------------------------------------- */

/**
 * The category of AI operation, which determines the timeout budget that
 * applies (Requirement 20.4). Each capability sub-interface pins its
 * {@link AIOperationKind} so the resilient wrapper can look up the right
 * timeout from an {@link AITimeoutConfig}.
 */
export const AIOperationKind = {
  /** Interactive/low-latency operations (chat, NL queries, suggestions) — 10s. */
  Query: 'query',
  /** AI-assisted report generation — 30s. */
  Report: 'report',
  /** Demand/stock/sales prediction over historical windows — 60s. */
  Prediction: 'prediction',
} as const;

/** Union of all valid {@link AIOperationKind} values. */
export type AIOperationKind = (typeof AIOperationKind)[keyof typeof AIOperationKind];

/**
 * Per-operation timeout budget in milliseconds (Requirement 20.4). Modelled as
 * a first-class part of the contract so timeouts are explicit and testable
 * rather than buried in an implementation. The resilient wrapper (task 37.2)
 * enforces these; a request MAY still override with {@link AICompletionRequest.timeoutMs}.
 */
export interface AITimeoutConfig {
  /** Budget for {@link AIOperationKind.Query} operations. Defaults to 10s. */
  readonly queryTimeoutMs: number;
  /** Budget for {@link AIOperationKind.Report} operations. Defaults to 30s. */
  readonly reportTimeoutMs: number;
  /** Budget for {@link AIOperationKind.Prediction} operations. Defaults to 60s. */
  readonly predictionTimeoutMs: number;
}

/**
 * The default timeout budget mandated by Requirement 20.4: 10 seconds for
 * queries, 30 seconds for reports, 60 seconds for predictions.
 */
export const DEFAULT_AI_TIMEOUTS: AITimeoutConfig = {
  queryTimeoutMs: 10_000,
  reportTimeoutMs: 30_000,
  predictionTimeoutMs: 60_000,
} as const;

/**
 * Resolves the timeout budget (ms) for an {@link AIOperationKind} from a
 * {@link AITimeoutConfig}. Kept as a pure helper so both the resilient wrapper
 * (task 37.2) and tests share one mapping and it stays consistent with
 * Requirement 20.4.
 *
 * @param kind - The operation category being performed.
 * @param config - The timeout budget to read from (defaults to {@link DEFAULT_AI_TIMEOUTS}).
 */
export function timeoutForOperation(
  kind: AIOperationKind,
  config: AITimeoutConfig = DEFAULT_AI_TIMEOUTS,
): number {
  switch (kind) {
    case AIOperationKind.Query:
      return config.queryTimeoutMs;
    case AIOperationKind.Report:
      return config.reportTimeoutMs;
    case AIOperationKind.Prediction:
      return config.predictionTimeoutMs;
    default:
      // Exhaustiveness guard: a new kind must extend the config + this switch.
      return assertNeverOperationKind(kind);
  }
}

/** Compile-time exhaustiveness guard for {@link AIOperationKind}. */
function assertNeverOperationKind(kind: never): never {
  throw new Error(`Unhandled AI operation kind: ${String(kind)}`);
}

/* -------------------------------------------------------------------------- */
/* Cost accounting + request context (Requirements 20.6, 20.3)                */
/* -------------------------------------------------------------------------- */

/**
 * Token/usage accounting for a single AI call, recorded for cost tracking and
 * quality monitoring (Requirement 20.6). The resilient wrapper (task 37.2)
 * populates this from the provider response and logs it per interaction.
 */
export interface AITokenUsage {
  /** Tokens consumed by the prompt/input. */
  readonly promptTokens: number;
  /** Tokens produced in the completion/output. */
  readonly completionTokens: number;
  /** Total tokens billed (`promptTokens + completionTokens`). */
  readonly totalTokens: number;
  /** Optional estimated cost in the provider's billing currency (minor unit-agnostic). */
  readonly estimatedCost?: number;
}

/**
 * The tenant-scoped context every AI capability request carries. AI features
 * operate strictly within a single tenant's data (Requirement 20.3 — no
 * cross-tenant leakage), and the correlation ids let the resilient wrapper log
 * each interaction (Requirement 20.6) alongside request logs.
 */
export interface AIRequestContext {
  /** The tenant the request is scoped to. Always required. */
  readonly tenantId: string;
  /** The acting user, when the call originates from a user request. */
  readonly userId?: string;
  /** Correlation id tying the AI interaction to the originating request. */
  readonly requestId?: string;
  /** Optional BCP-47 locale so responses can be localized (e.g. `'es-AR'`). */
  readonly locale?: string;
}

/* -------------------------------------------------------------------------- */
/* Generic completion request/response                                        */
/* -------------------------------------------------------------------------- */

/**
 * A generic AI prompt/completion request — the lowest-common-denominator shape
 * the base {@link IAIService.complete} accepts, sitting one level above the
 * plugin `AICompletionRequest`. Capability services expose richer, domain-shaped
 * requests but ultimately reduce to a completion the resilient wrapper runs
 * against a provider.
 */
export interface AICompletionRequest {
  /** Tenant scope + correlation for the call (Requirement 20.3/20.6). */
  readonly context: AIRequestContext;
  /** The user/content prompt to complete. */
  readonly prompt: string;
  /** Optional system/instruction prompt steering the model. */
  readonly system?: string;
  /** Optional upper bound on generated tokens. */
  readonly maxTokens?: number;
  /** Optional sampling temperature. */
  readonly temperature?: number;
  /**
   * Optional explicit provider selection (Requirement 20.2). When omitted the
   * resilient wrapper (task 37.2) chooses/failovers between providers.
   */
  readonly provider?: AIProviderKind;
  /**
   * Optional per-call timeout override (ms). When omitted the wrapper applies
   * the {@link AITimeoutConfig} budget for the operation (Requirement 20.4).
   */
  readonly timeoutMs?: number;
}

/**
 * The result of a generic AI completion, including the provider/model that
 * served it and the {@link AITokenUsage} for cost tracking (Requirement 20.6).
 */
export interface AICompletionResponse {
  /** The generated text. */
  readonly text: string;
  /** Which provider served the request (Requirement 20.2). */
  readonly provider: AIProviderKind;
  /** The concrete model id that produced the completion. */
  readonly model: string;
  /** Token/usage accounting, when the provider reports it (Requirement 20.6). */
  readonly usage?: AITokenUsage;
  /** Optional provider-reported reason the generation stopped (e.g. `'stop'`, `'length'`). */
  readonly finishReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Base AI service port                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The base application-facing AI port (Requirement 20.1/20.3).
 *
 * Consumers depend only on this abstraction; the concrete resilient wrapper
 * (task 37.2, composing `AIPlugin` providers) binds behind it in the
 * composition root. The contract makes timeouts first-class: it exposes the
 * active {@link AITimeoutConfig} and a helper to resolve the budget for an
 * {@link AIOperationKind} (Requirement 20.4), and an {@link isEnabled} probe so
 * callers can degrade gracefully when no provider is configured
 * (Requirement 20.5) instead of failing a core operation.
 */
export interface IAIService {
  /** The per-operation timeout budget this service enforces (Requirement 20.4). */
  readonly timeouts: AITimeoutConfig;

  /**
   * Whether a usable AI provider is configured/reachable. When `false`, callers
   * SHOULD skip the AI enhancement and continue the core operation
   * (Requirement 20.5) rather than invoking {@link complete}.
   */
  isEnabled(): boolean;

  /**
   * Resolves the timeout budget (ms) for an operation category from
   * {@link timeouts} (Requirement 20.4). Convenience over
   * {@link timeoutForOperation} bound to this service's config.
   */
  timeoutFor(kind: AIOperationKind): number;

  /**
   * Runs a generic completion against a provider, honouring the timeout budget
   * and recording usage. Implementations MUST throw an {@link import('./ai-errors.js').AIUnavailableError}
   * when no provider is available and an {@link import('./ai-errors.js').AITimeoutError}
   * when the budget is exceeded, so callers can distinguish degradation from
   * other failures (Requirement 20.5).
   *
   * @param request - The prompt, tenant context and generation options.
   */
  complete(request: AICompletionRequest): Promise<AICompletionResponse>;
}

/* -------------------------------------------------------------------------- */
/* Capability sub-interfaces (Requirement 20.1/20.3)                          */
/*                                                                            */
/* Each is a THIN, domain-shaped contract for one AI capability and pins the  */
/* AIOperationKind that selects its timeout budget (Requirement 20.4). All    */
/* requests are tenant-scoped via AIRequestContext (Requirement 20.3).        */
/* -------------------------------------------------------------------------- */

/**
 * Common shape shared by every capability service: it declares the
 * {@link AIOperationKind} it performs so the resilient wrapper (task 37.2) can
 * apply the correct timeout (Requirement 20.4) uniformly across capabilities.
 */
export interface AICapability {
  /** The operation category this capability performs (drives the timeout budget). */
  readonly operationKind: AIOperationKind;
}

/* ---- Sales Assistant ----------------------------------------------------- */

/** A single turn in a sales-assistant conversation. */
export interface SalesAssistantMessage {
  /** Who authored the turn. */
  readonly role: 'user' | 'assistant';
  /** The message text. */
  readonly content: string;
}

/** A request to the conversational sales assistant. */
export interface SalesAssistantRequest {
  /** Tenant scope + correlation (Requirement 20.3). */
  readonly context: AIRequestContext;
  /** The user's latest message. */
  readonly message: string;
  /** Prior conversation turns for multi-turn context, oldest first. */
  readonly history?: readonly SalesAssistantMessage[];
}

/** The sales assistant's reply. */
export interface SalesAssistantResponse {
  /** The assistant's natural-language reply. */
  readonly reply: string;
  /** Optional follow-up suggestions the UI can surface as quick replies. */
  readonly suggestions?: readonly string[];
  /** Usage for cost tracking (Requirement 20.6). */
  readonly usage?: AITokenUsage;
}

/**
 * Conversational sales assistance (Requirement 20.1). An interactive capability,
 * so it uses the {@link AIOperationKind.Query} timeout budget.
 */
export interface ISalesAssistantService extends AICapability {
  /** Interactive → query timeout (10s, Requirement 20.4). */
  readonly operationKind: typeof AIOperationKind.Query;
  /** Continues a tenant-scoped sales conversation and returns the reply. */
  chat(request: SalesAssistantRequest): Promise<SalesAssistantResponse>;
}

/* ---- Stock Prediction ---------------------------------------------------- */

/** One historical observation used to predict future demand. */
export interface StockHistoryPoint {
  /** ISO-8601 date of the observation. */
  readonly date: string;
  /** Units sold on that date. */
  readonly quantitySold: number;
  /** Optional on-hand quantity at that date (informs reorder suggestions). */
  readonly quantityOnHand?: number;
}

/** A request to predict demand for a product over a horizon. */
export interface StockPredictionRequest {
  /** Tenant scope + correlation (Requirement 20.3). */
  readonly context: AIRequestContext;
  /** The product to predict demand for. */
  readonly productId: string;
  /** The historical sales/stock window, oldest first. */
  readonly history: readonly StockHistoryPoint[];
  /** How many days ahead to predict. */
  readonly horizonDays: number;
}

/** The predicted demand and optional reorder guidance. */
export interface StockPredictionResponse {
  /** Echoes the product the prediction is for. */
  readonly productId: string;
  /** Predicted units of demand over the requested horizon. */
  readonly predictedDemand: number;
  /** Optional suggested reorder quantity given demand + on-hand levels. */
  readonly reorderSuggestion?: number;
  /** Optional model confidence in `[0, 1]`. */
  readonly confidence?: number;
  /** Usage for cost tracking (Requirement 20.6). */
  readonly usage?: AITokenUsage;
}

/**
 * Stock/demand prediction (Requirement 20.1). A heavier operation over a
 * historical window, so it uses the {@link AIOperationKind.Prediction} budget.
 */
export interface IStockPredictionService extends AICapability {
  /** Heavier analysis → prediction timeout (60s, Requirement 20.4). */
  readonly operationKind: typeof AIOperationKind.Prediction;
  /** Predicts demand and an optional reorder quantity for a product. */
  predictDemand(request: StockPredictionRequest): Promise<StockPredictionResponse>;
}

/* ---- Natural Language Query --------------------------------------------- */

/** A natural-language question over the tenant's data. */
export interface NaturalLanguageQueryRequest {
  /** Tenant scope + correlation (Requirement 20.3). */
  readonly context: AIRequestContext;
  /** The plain-language question (e.g. "top 5 products last month"). */
  readonly question: string;
}

/**
 * The answer to a natural-language query. Actual data access is OUT OF SCOPE
 * here (task 37.1 is contracts only); the {@link structuredQuery} field is the
 * seam a later implementation uses to hand a validated, tenant-scoped query to
 * the data layer.
 */
export interface NaturalLanguageQueryResponse {
  /** A natural-language answer derived from the tenant's data. */
  readonly answer: string;
  /**
   * Optional structured representation of the query the NL question was
   * translated into (filters, metrics, groupings). Opaque here — the executing
   * layer defines and validates its concrete shape.
   */
  readonly structuredQuery?: Readonly<Record<string, unknown>>;
  /** Usage for cost tracking (Requirement 20.6). */
  readonly usage?: AITokenUsage;
}

/**
 * Natural-language querying over tenant data (Requirement 20.1). Interactive,
 * so it uses the {@link AIOperationKind.Query} budget.
 */
export interface INaturalLanguageQueryService extends AICapability {
  /** Interactive → query timeout (10s, Requirement 20.4). */
  readonly operationKind: typeof AIOperationKind.Query;
  /** Answers a tenant-scoped natural-language question. */
  ask(request: NaturalLanguageQueryRequest): Promise<NaturalLanguageQueryResponse>;
}

/* ---- Report Generation --------------------------------------------------- */

/** A request to generate an AI-assisted report. */
export interface ReportGenerationRequest {
  /** Tenant scope + correlation (Requirement 20.3). */
  readonly context: AIRequestContext;
  /** Optional identifier of the report type/template being narrated. */
  readonly reportType?: string;
  /** The instruction/prompt describing the desired report. */
  readonly prompt: string;
  /** Optional structured input rows the narrative should be grounded in. */
  readonly data?: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

/** A single titled section of a generated report. */
export interface ReportSection {
  /** The section heading. */
  readonly title: string;
  /** The section body. */
  readonly content: string;
}

/** A generated report: a narrative plus optional structured sections. */
export interface ReportGenerationResponse {
  /** The full narrative report text. */
  readonly narrative: string;
  /** Optional structured breakdown into titled sections. */
  readonly sections?: readonly ReportSection[];
  /** Usage for cost tracking (Requirement 20.6). */
  readonly usage?: AITokenUsage;
}

/**
 * AI-assisted report generation (Requirement 20.1). Uses the
 * {@link AIOperationKind.Report} budget (30s, Requirement 20.4).
 */
export interface IReportGenerationService extends AICapability {
  /** Report generation → report timeout (30s, Requirement 20.4). */
  readonly operationKind: typeof AIOperationKind.Report;
  /** Generates a narrative/structured report from a spec/prompt. */
  generateReport(request: ReportGenerationRequest): Promise<ReportGenerationResponse>;
}

/* ---- Automation Suggestions --------------------------------------------- */

/** A request for automation suggestions from tenant activity context. */
export interface AutomationSuggestionRequest {
  /** Tenant scope + correlation (Requirement 20.3). */
  readonly context: AIRequestContext;
  /** Optional recent activity signals the suggestions should be grounded in. */
  readonly activity?: ReadonlyArray<Readonly<Record<string, unknown>>>;
}

/** A single suggested automation the tenant could enable. */
export interface AutomationSuggestion {
  /** Short title of the suggested automation. */
  readonly title: string;
  /** Human-readable description of what it would do and why. */
  readonly description: string;
  /** Optional machine-readable action kind a later engine could execute. */
  readonly actionKind?: string;
  /** Optional confidence in `[0, 1]`. */
  readonly confidence?: number;
}

/** The set of suggested automations. */
export interface AutomationSuggestionResponse {
  /** The suggested automations, most relevant first. */
  readonly suggestions: readonly AutomationSuggestion[];
  /** Usage for cost tracking (Requirement 20.6). */
  readonly usage?: AITokenUsage;
}

/**
 * Automation suggestions from tenant activity (Requirement 20.1). Interactive,
 * so it uses the {@link AIOperationKind.Query} budget (10s, Requirement 20.4).
 */
export interface IAutomationSuggestionService extends AICapability {
  /** Interactive → query timeout (10s, Requirement 20.4). */
  readonly operationKind: typeof AIOperationKind.Query;
  /** Suggests automations for a tenant based on its activity context. */
  suggestAutomations(
    request: AutomationSuggestionRequest,
  ): Promise<AutomationSuggestionResponse>;
}
