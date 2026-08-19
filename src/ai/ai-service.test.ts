import { describe, it, expect } from 'vitest';
import { DomainError, ErrorCode } from '@domain/errors/index.js';
import {
  AIOperationKind,
  DEFAULT_AI_TIMEOUTS,
  timeoutForOperation,
  type AITimeoutConfig,
  type AICompletionRequest,
  type AICompletionResponse,
  type AIRequestContext,
  type IAIService,
  type ISalesAssistantService,
  type IStockPredictionService,
  type SalesAssistantRequest,
  type SalesAssistantResponse,
  type StockPredictionRequest,
  type StockPredictionResponse,
} from './ai-service.js';
import { AIError, AIUnavailableError, AITimeoutError } from './ai-errors.js';

/**
 * Task 37.1 is CONTRACTS-ONLY, so these are contract-guarding tests: tiny
 * in-memory fakes implement the ports (proving they compose and are
 * implementable), and the pure timeout/operation-kind helpers + error hierarchy
 * are exercised directly (Requirements 20.1, 20.3, 20.4, 20.5).
 */

const context: AIRequestContext = { tenantId: 'tenant-1', userId: 'user-1' };

/**
 * Minimal in-memory {@link IAIService}: echoes the prompt back, records fixed
 * usage, and resolves timeouts from an injected {@link AITimeoutConfig}. Proves
 * the base port composes without any provider SDK.
 */
class FakeAIService implements IAIService {
  constructor(readonly timeouts: AITimeoutConfig = DEFAULT_AI_TIMEOUTS) {}

  isEnabled(): boolean {
    return true;
  }

  timeoutFor(kind: AIOperationKind): number {
    return timeoutForOperation(kind, this.timeouts);
  }

  async complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    return {
      text: `echo:${request.prompt}`,
      provider: request.provider ?? 'openai',
      model: 'fake-model',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      finishReason: 'stop',
    };
  }
}

/** Disabled {@link IAIService} modelling graceful degradation (Requirement 20.5). */
class DisabledAIService implements IAIService {
  readonly timeouts = DEFAULT_AI_TIMEOUTS;

  isEnabled(): boolean {
    return false;
  }

  timeoutFor(kind: AIOperationKind): number {
    return timeoutForOperation(kind, this.timeouts);
  }

  async complete(_request: AICompletionRequest): Promise<AICompletionResponse> {
    throw new AIUnavailableError('no provider configured', { operationKind: AIOperationKind.Query });
  }
}

/** In-memory sales assistant pinned to the query operation kind. */
class FakeSalesAssistant implements ISalesAssistantService {
  readonly operationKind = AIOperationKind.Query;

  async chat(request: SalesAssistantRequest): Promise<SalesAssistantResponse> {
    return {
      reply: `re: ${request.message}`,
      suggestions: ['See stock', 'Create sale'],
      usage: { promptTokens: 3, completionTokens: 4, totalTokens: 7 },
    };
  }
}

/** In-memory stock predictor pinned to the prediction operation kind. */
class FakeStockPredictor implements IStockPredictionService {
  readonly operationKind = AIOperationKind.Prediction;

  async predictDemand(request: StockPredictionRequest): Promise<StockPredictionResponse> {
    const total = request.history.reduce((sum, point) => sum + point.quantitySold, 0);
    return {
      productId: request.productId,
      predictedDemand: total,
      reorderSuggestion: total,
      confidence: 0.5,
    };
  }
}

describe('AI timeout configuration (Requirement 20.4)', () => {
  it('defaults to 10s queries, 30s reports, 60s predictions', () => {
    expect(DEFAULT_AI_TIMEOUTS).toEqual({
      queryTimeoutMs: 10_000,
      reportTimeoutMs: 30_000,
      predictionTimeoutMs: 60_000,
    });
  });

  it('maps each operation kind to its budget', () => {
    expect(timeoutForOperation(AIOperationKind.Query)).toBe(10_000);
    expect(timeoutForOperation(AIOperationKind.Report)).toBe(30_000);
    expect(timeoutForOperation(AIOperationKind.Prediction)).toBe(60_000);
  });

  it('honours a custom timeout config', () => {
    const config: AITimeoutConfig = {
      queryTimeoutMs: 5_000,
      reportTimeoutMs: 15_000,
      predictionTimeoutMs: 45_000,
    };
    expect(timeoutForOperation(AIOperationKind.Report, config)).toBe(15_000);
  });
});

describe('IAIService base port', () => {
  it('composes as an in-memory fake and resolves per-operation timeouts', async () => {
    const service: IAIService = new FakeAIService();

    expect(service.isEnabled()).toBe(true);
    expect(service.timeoutFor(AIOperationKind.Prediction)).toBe(60_000);

    const response = await service.complete({ context, prompt: 'hello', provider: 'claude' });
    expect(response.text).toBe('echo:hello');
    expect(response.provider).toBe('claude');
    expect(response.usage?.totalTokens).toBe(2);
  });

  it('a disabled service reports isEnabled=false and throws AIUnavailableError', async () => {
    const service: IAIService = new DisabledAIService();
    expect(service.isEnabled()).toBe(false);
    await expect(service.complete({ context, prompt: 'x' })).rejects.toBeInstanceOf(
      AIUnavailableError,
    );
  });
});

describe('AI capability sub-interfaces (Requirements 20.1/20.3)', () => {
  it('sales assistant is tenant-scoped and pinned to the query timeout', async () => {
    const assistant: ISalesAssistantService = new FakeSalesAssistant();
    expect(assistant.operationKind).toBe(AIOperationKind.Query);
    expect(timeoutForOperation(assistant.operationKind)).toBe(10_000);

    const result = await assistant.chat({ context, message: 'best sellers?' });
    expect(result.reply).toContain('best sellers?');
    expect(result.suggestions).toHaveLength(2);
  });

  it('stock prediction is pinned to the prediction timeout and aggregates history', async () => {
    const predictor: IStockPredictionService = new FakeStockPredictor();
    expect(predictor.operationKind).toBe(AIOperationKind.Prediction);
    expect(timeoutForOperation(predictor.operationKind)).toBe(60_000);

    const result = await predictor.predictDemand({
      context,
      productId: 'prod-1',
      horizonDays: 7,
      history: [
        { date: '2024-01-01', quantitySold: 2 },
        { date: '2024-01-02', quantitySold: 3 },
      ],
    });
    expect(result.productId).toBe('prod-1');
    expect(result.predictedDemand).toBe(5);
  });
});

describe('AI error contracts (Requirements 20.4/20.5)', () => {
  it('AIUnavailableError is a DomainError with the AI_UNAVAILABLE code and 503 status', () => {
    const error = new AIUnavailableError('down', { provider: 'gemini' });
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toBeInstanceOf(AIError);
    expect(error.code).toBe(ErrorCode.AI_UNAVAILABLE);
    expect(error.httpStatus).toBe(503);
    expect(error.details).toEqual({ provider: 'gemini' });
  });

  it('AITimeoutError is a DomainError with the AI_TIMEOUT code and 504 status', () => {
    const error = new AITimeoutError('slow', { operationKind: AIOperationKind.Prediction });
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe(ErrorCode.AI_TIMEOUT);
    expect(error.httpStatus).toBe(504);
    expect(error.details).toEqual({ operationKind: 'prediction' });
  });

  it('leaves details undefined when no context is supplied', () => {
    expect(new AIUnavailableError().details).toBeUndefined();
    expect(new AITimeoutError().name).toBe('AITimeoutError');
  });
});
