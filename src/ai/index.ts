/**
 * Public interface of the AI Integration Layer (task 37.1, Requirements 20.1,
 * 20.3, 20.4).
 *
 * Exposes the application-facing {@link IAIService} port and its capability
 * sub-interfaces (Sales Assistant, Stock Prediction, Natural Language Queries,
 * Report Generation, Automation Suggestions), the first-class timeout model
 * ({@link AIOperationKind} / {@link AITimeoutConfig}), the token/usage and
 * request/response types, and the AI domain error contracts. This is
 * contracts-only preparation: no vendor SDK is imported and no provider is
 * bound. The resilient wrapper (task 37.2) implements {@link IAIService} over
 * the plugin `AIPlugin` providers; the endpoints (task 37.3) build on it.
 */

export {
  AIOperationKind,
  DEFAULT_AI_TIMEOUTS,
  timeoutForOperation,
} from './ai-service.js';
export type {
  AIProviderKind,
  AITimeoutConfig,
  AITokenUsage,
  AIRequestContext,
  AICompletionRequest,
  AICompletionResponse,
  IAIService,
  AICapability,
  SalesAssistantMessage,
  SalesAssistantRequest,
  SalesAssistantResponse,
  ISalesAssistantService,
  StockHistoryPoint,
  StockPredictionRequest,
  StockPredictionResponse,
  IStockPredictionService,
  NaturalLanguageQueryRequest,
  NaturalLanguageQueryResponse,
  INaturalLanguageQueryService,
  ReportGenerationRequest,
  ReportSection,
  ReportGenerationResponse,
  IReportGenerationService,
  AutomationSuggestionRequest,
  AutomationSuggestion,
  AutomationSuggestionResponse,
  IAutomationSuggestionService,
} from './ai-service.js';

export { AIError, AIUnavailableError, AITimeoutError } from './ai-errors.js';
export type { AIErrorContext } from './ai-errors.js';

// Resilient wrapper + provider port (task 37.2, Requirements 20.2/20.4/20.5/20.6).
export { NoopAIProvider } from './ai-provider.js';
export type { AIProvider } from './ai-provider.js';
// Circuit-breaker provider decorator (task 41.2, Requirement 27.3).
export { CircuitBreakerAIProvider } from './circuit-breaker-ai-provider.js';
export {
  ResilientAIService,
  systemAITimer,
  AI_INTERACTION_LOG_EVENT,
} from './resilient-ai-service.js';
export type {
  AIInteractionLogger,
  AIClock,
  AITimer,
  AIInteractionOutcome,
  ResilientAIServiceOptions,
  IOperationAwareAIService,
} from './resilient-ai-service.js';
export {
  SalesAssistantService,
  NaturalLanguageQueryService,
  ReportGenerationService,
} from './ai-capabilities.js';
