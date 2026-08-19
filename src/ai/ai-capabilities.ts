import {
  AIOperationKind,
  type AICompletionRequest,
  type INaturalLanguageQueryService,
  type IReportGenerationService,
  type ISalesAssistantService,
  type NaturalLanguageQueryRequest,
  type NaturalLanguageQueryResponse,
  type ReportGenerationRequest,
  type ReportGenerationResponse,
  type SalesAssistantRequest,
  type SalesAssistantResponse,
} from './ai-service.js';
import type { IOperationAwareAIService } from './resilient-ai-service.js';

/**
 * AI Integration Layer — thin capability adapters (task 37.2, Requirements
 * 20.1, 20.4).
 *
 * These are LIGHTWEIGHT capability services that reduce a domain-shaped request
 * to a generic completion and delegate to the resilient
 * {@link IOperationAwareAIService}, which owns timeouts, failover, graceful
 * degradation and cost logging. Each pins the {@link AIOperationKind} that
 * selects its timeout budget (Requirement 20.4), so it runs under the right
 * budget without any call-site guesswork. Only the capabilities whose result
 * maps cleanly from generated text are implemented here (Sales Assistant, NL
 * Query, Report Generation); capabilities needing structured extraction (Stock
 * Prediction, Automation Suggestions) are left for a later task. The endpoints
 * (task 37.3) expose these behind the Enterprise plan gate.
 *
 * When AI is disabled or every provider fails, the delegate throws
 * `AIUnavailableError` / `AITimeoutError`; these adapters intentionally do NOT
 * swallow it — the ENDPOINT layer decides how to degrade (Requirement 20.5).
 */

/** Builds the tenant-scoped completion request shared by the capabilities. */
function buildCompletionRequest(
  request: { readonly context: SalesAssistantRequest['context'] },
  prompt: string,
  system?: string,
): AICompletionRequest {
  return system === undefined
    ? { context: request.context, prompt }
    : { context: request.context, prompt, system };
}

/**
 * Conversational sales assistance (Requirement 20.1) over the resilient service.
 * Interactive, so it uses the {@link AIOperationKind.Query} budget (10s).
 */
export class SalesAssistantService implements ISalesAssistantService {
  readonly operationKind = AIOperationKind.Query;

  constructor(private readonly ai: IOperationAwareAIService) {}

  async chat(request: SalesAssistantRequest): Promise<SalesAssistantResponse> {
    const history = (request.history ?? [])
      .map((turn) => `${turn.role}: ${turn.content}`)
      .join('\n');
    const prompt = history.length > 0 ? `${history}\nuser: ${request.message}` : request.message;
    const response = await this.ai.completeForOperation(
      buildCompletionRequest(
        request,
        prompt,
        'You are a helpful sales assistant for a small business ERP.',
      ),
      this.operationKind,
    );
    return response.usage === undefined
      ? { reply: response.text }
      : { reply: response.text, usage: response.usage };
  }
}

/**
 * Natural-language querying over tenant data (Requirement 20.1). Interactive, so
 * it uses the {@link AIOperationKind.Query} budget (10s). Data access is out of
 * scope here — this returns the model's natural-language answer.
 */
export class NaturalLanguageQueryService implements INaturalLanguageQueryService {
  readonly operationKind = AIOperationKind.Query;

  constructor(private readonly ai: IOperationAwareAIService) {}

  async ask(request: NaturalLanguageQueryRequest): Promise<NaturalLanguageQueryResponse> {
    const response = await this.ai.completeForOperation(
      buildCompletionRequest(
        request,
        request.question,
        'Answer questions about the tenant business data concisely.',
      ),
      this.operationKind,
    );
    return response.usage === undefined
      ? { answer: response.text }
      : { answer: response.text, usage: response.usage };
  }
}

/**
 * AI-assisted report generation (Requirement 20.1). Uses the
 * {@link AIOperationKind.Report} budget (30s).
 */
export class ReportGenerationService implements IReportGenerationService {
  readonly operationKind = AIOperationKind.Report;

  constructor(private readonly ai: IOperationAwareAIService) {}

  async generateReport(request: ReportGenerationRequest): Promise<ReportGenerationResponse> {
    const dataBlock =
      request.data !== undefined && request.data.length > 0
        ? `\n\nData:\n${JSON.stringify(request.data)}`
        : '';
    const response = await this.ai.completeForOperation(
      buildCompletionRequest(
        request,
        `${request.prompt}${dataBlock}`,
        'Generate a clear business report narrative from the provided instruction and data.',
      ),
      this.operationKind,
    );
    return response.usage === undefined
      ? { narrative: response.text }
      : { narrative: response.text, usage: response.usage };
  }
}
