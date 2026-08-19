import { describe, it, expect, beforeEach } from 'vitest';
import {
  AIOperationKind,
  type AICompletionRequest,
  type AICompletionResponse,
  type AIProviderKind,
  type AIRequestContext,
} from './ai-service.js';
import { AITimeoutError, AIUnavailableError } from './ai-errors.js';
import type { AIProvider } from './ai-provider.js';
import {
  AI_INTERACTION_LOG_EVENT,
  ResilientAIService,
  type AITimer,
} from './resilient-ai-service.js';
import {
  ReportGenerationService,
  SalesAssistantService,
} from './ai-capabilities.js';

/**
 * Task 37.2 tests for the RESILIENT AI WRAPPER (Requirements 20.2/20.4/20.5/20.6).
 *
 * Everything is deterministic: a manual {@link AITimer} fires timeouts on demand
 * (NO real multi-second waits) and a stepping clock yields fixed latencies. Fake
 * providers model resolve / throw / hang, and a recording logger captures the
 * cost-tracking lines.
 */

const context: AIRequestContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  requestId: 'req-1',
};

/** {@link AITimer} that records scheduled callbacks and fires them on demand. */
class ManualTimer implements AITimer {
  private tasks = new Set<() => void>();
  /** The most recent delay (ms) passed to {@link schedule}. */
  lastMs: number | undefined;

  schedule(fn: () => void, ms: number): () => void {
    this.lastMs = ms;
    this.tasks.add(fn);
    return (): void => {
      this.tasks.delete(fn);
    };
  }

  /** Fires (and clears) every currently-pending timeout callback. */
  fireAll(): void {
    const pending = [...this.tasks];
    this.tasks.clear();
    for (const fn of pending) {
      fn();
    }
  }
}

/** Stepping clock: each read advances by 5ms, so latency is a fixed 5ms. */
function steppingClock(): () => number {
  let now = 1000;
  return () => {
    const value = now;
    now += 5;
    return value;
  };
}

/** Recording cost-tracking logger. */
class RecordingLogger {
  readonly lines: Array<Record<string, unknown>> = [];
  info(obj: Record<string, unknown>): void {
    this.lines.push(obj);
  }
}

type ProviderBehavior = 'resolve' | 'throw' | 'hang';

/** Fake {@link AIProvider} modelling resolve / throw / never-settle behaviour. */
class FakeProvider implements AIProvider {
  calls = 0;
  constructor(
    readonly kind: AIProviderKind,
    private readonly behavior: ProviderBehavior,
  ) {}

  complete(_request: AICompletionRequest): Promise<AICompletionResponse> {
    this.calls += 1;
    if (this.behavior === 'resolve') {
      return Promise.resolve({
        text: `answer from ${this.kind}`,
        provider: this.kind,
        model: `${this.kind}-model`,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, estimatedCost: 0.42 },
        finishReason: 'stop',
      });
    }
    if (this.behavior === 'throw') {
      return Promise.reject(new Error(`${this.kind} boom`));
    }
    // 'hang' — never settles; only the injected timer can end the race.
    return new Promise<AICompletionResponse>(() => {});
  }
}

const baseRequest: AICompletionRequest = { context, prompt: 'hello' };

describe('ResilientAIService — graceful degradation (Requirement 20.5)', () => {
  let logger: RecordingLogger;
  let timer: ManualTimer;

  beforeEach(() => {
    logger = new RecordingLogger();
    timer = new ManualTimer();
  });

  it('reports isEnabled=false with no providers configured', () => {
    const service = new ResilientAIService({ logger, timer, clock: steppingClock() });
    expect(service.isEnabled()).toBe(false);
  });

  it('throws AIUnavailableError and logs an unavailable interaction when disabled', async () => {
    const service = new ResilientAIService({ logger, timer, clock: steppingClock() });

    await expect(service.complete(baseRequest)).rejects.toBeInstanceOf(AIUnavailableError);

    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]).toMatchObject({
      event: AI_INTERACTION_LOG_EVENT,
      outcome: 'unavailable',
      operation_kind: AIOperationKind.Query,
      tenant_id: 'tenant-1',
      latency_ms: 5,
    });
  });

  it('throws AIUnavailableError when every configured provider fails', async () => {
    const service = new ResilientAIService({
      providers: [new FakeProvider('openai', 'throw'), new FakeProvider('claude', 'throw')],
      logger,
      timer,
      clock: steppingClock(),
    });

    await expect(service.complete(baseRequest)).rejects.toBeInstanceOf(AIUnavailableError);
  });
});

describe('ResilientAIService — successful completion + cost logging (Requirement 20.6)', () => {
  it('returns the provider response with usage and logs usage + context + latency', async () => {
    const logger = new RecordingLogger();
    const service = new ResilientAIService({
      providers: [new FakeProvider('openai', 'resolve')],
      logger,
      timer: new ManualTimer(),
      clock: steppingClock(),
    });

    const response = await service.complete(baseRequest);

    expect(response.provider).toBe('openai');
    expect(response.text).toBe('answer from openai');
    expect(response.usage?.totalTokens).toBe(30);

    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]).toMatchObject({
      event: AI_INTERACTION_LOG_EVENT,
      outcome: 'success',
      operation_kind: AIOperationKind.Query,
      provider: 'openai',
      model: 'openai-model',
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
      estimated_cost: 0.42,
      tenant_id: 'tenant-1',
      user_id: 'user-1',
      request_id: 'req-1',
      latency_ms: 5,
    });
  });

  it('never throws from logging even when the sink throws', async () => {
    const throwingLogger = {
      info(): void {
        throw new Error('log sink down');
      },
    };
    const service = new ResilientAIService({
      providers: [new FakeProvider('openai', 'resolve')],
      logger: throwingLogger,
      timer: new ManualTimer(),
      clock: steppingClock(),
    });

    const response = await service.complete(baseRequest);
    expect(response.text).toBe('answer from openai');
  });
});

describe('ResilientAIService — timeouts per operation kind (Requirement 20.4)', () => {
  it('applies the 10s query budget and throws AITimeoutError on exceed', async () => {
    const timer = new ManualTimer();
    const service = new ResilientAIService({
      providers: [new FakeProvider('openai', 'hang')],
      logger: new RecordingLogger(),
      timer,
      clock: steppingClock(),
    });

    const pending = service.complete(baseRequest);
    expect(timer.lastMs).toBe(10_000);
    timer.fireAll();

    await expect(pending).rejects.toBeInstanceOf(AITimeoutError);
  });

  it('applies the 30s report budget for the report operation kind', async () => {
    const timer = new ManualTimer();
    const service = new ResilientAIService({
      providers: [new FakeProvider('openai', 'hang')],
      logger: new RecordingLogger(),
      timer,
      clock: steppingClock(),
    });

    const pending = service.completeForOperation(baseRequest, AIOperationKind.Report);
    expect(timer.lastMs).toBe(30_000);
    timer.fireAll();

    await expect(pending).rejects.toBeInstanceOf(AITimeoutError);
  });

  it('applies the 60s prediction budget for the prediction operation kind', async () => {
    const timer = new ManualTimer();
    const logger = new RecordingLogger();
    const service = new ResilientAIService({
      providers: [new FakeProvider('gemini', 'hang')],
      logger,
      timer,
      clock: steppingClock(),
    });

    const pending = service.completeForOperation(baseRequest, AIOperationKind.Prediction);
    expect(timer.lastMs).toBe(60_000);
    timer.fireAll();

    await expect(pending).rejects.toBeInstanceOf(AITimeoutError);
    expect(logger.lines.some((line) => line.outcome === 'timeout')).toBe(true);
  });

  it('honours a per-request timeout override', async () => {
    const timer = new ManualTimer();
    const service = new ResilientAIService({
      providers: [new FakeProvider('openai', 'hang')],
      logger: new RecordingLogger(),
      timer,
      clock: steppingClock(),
    });

    const pending = service.complete({ ...baseRequest, timeoutMs: 1_500 });
    expect(timer.lastMs).toBe(1_500);
    timer.fireAll();

    await expect(pending).rejects.toBeInstanceOf(AITimeoutError);
  });
});

describe('ResilientAIService — provider selection + failover (Requirement 20.2)', () => {
  it('fails over to the next provider when the first throws', async () => {
    const first = new FakeProvider('openai', 'throw');
    const second = new FakeProvider('claude', 'resolve');
    const logger = new RecordingLogger();
    const service = new ResilientAIService({
      providers: [first, second],
      logger,
      timer: new ManualTimer(),
      clock: steppingClock(),
    });

    const response = await service.complete(baseRequest);

    expect(first.calls).toBe(1);
    expect(second.calls).toBe(1);
    expect(response.provider).toBe('claude');
    expect(logger.lines.some((line) => line.outcome === 'error')).toBe(true);
    expect(logger.lines.some((line) => line.outcome === 'success')).toBe(true);
  });

  it('tries an explicitly requested provider first', async () => {
    const openai = new FakeProvider('openai', 'resolve');
    const claude = new FakeProvider('claude', 'resolve');
    const service = new ResilientAIService({
      providers: [openai, claude],
      logger: new RecordingLogger(),
      timer: new ManualTimer(),
      clock: steppingClock(),
    });

    const response = await service.complete({ ...baseRequest, provider: 'claude' });

    expect(response.provider).toBe('claude');
    expect(claude.calls).toBe(1);
    expect(openai.calls).toBe(0);
  });
});

describe('AI capability adapters delegate with the correct operation budget', () => {
  it('SalesAssistantService uses the query budget and returns the reply', async () => {
    const timer = new ManualTimer();
    const service = new ResilientAIService({
      providers: [new FakeProvider('openai', 'resolve')],
      logger: new RecordingLogger(),
      timer,
      clock: steppingClock(),
    });
    const assistant = new SalesAssistantService(service);

    const result = await assistant.chat({ context, message: 'best sellers?' });

    expect(result.reply).toBe('answer from openai');
    expect(result.usage?.totalTokens).toBe(30);
    expect(timer.lastMs).toBe(10_000);
  });

  it('ReportGenerationService uses the 30s report budget', async () => {
    const timer = new ManualTimer();
    const service = new ResilientAIService({
      providers: [new FakeProvider('openai', 'resolve')],
      logger: new RecordingLogger(),
      timer,
      clock: steppingClock(),
    });
    const reports = new ReportGenerationService(service);

    const result = await reports.generateReport({
      context,
      prompt: 'monthly sales',
      data: [{ month: 'jan', total: 100 }],
    });

    expect(result.narrative).toBe('answer from openai');
    expect(timer.lastMs).toBe(30_000);
  });
});
