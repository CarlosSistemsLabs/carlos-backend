import { describe, it, expect, vi } from 'vitest';
import { CircuitOpenError, CircuitState } from '@common/resilience/index.js';
import type {
  AICompletionRequest,
  AICompletionResponse,
  AIProviderKind,
} from './ai-service.js';
import type { AIProvider } from './ai-provider.js';
import { CircuitBreakerAIProvider } from './circuit-breaker-ai-provider.js';

const REQUEST: AICompletionRequest = {
  context: { tenantId: 'tenant-1' },
  prompt: 'hello',
};

function response(kind: AIProviderKind): AICompletionResponse {
  return { text: 'hi', provider: kind, model: `${kind}-model` };
}

/** A controllable delegate provider whose `complete` behaviour the test sets. */
function stubProvider(
  kind: AIProviderKind,
  complete: (request: AICompletionRequest) => Promise<AICompletionResponse>,
): AIProvider & { complete: ReturnType<typeof vi.fn> } {
  return { kind, complete: vi.fn(complete) };
}

describe('CircuitBreakerAIProvider', () => {
  it('inherits the delegate provider kind', () => {
    const delegate = stubProvider('claude', () => Promise.resolve(response('claude')));
    const guarded = new CircuitBreakerAIProvider(delegate);
    expect(guarded.kind).toBe('claude');
  });

  it('delegates completions while CLOSED and returns the delegate response', async () => {
    const delegate = stubProvider('openai', () => Promise.resolve(response('openai')));
    const guarded = new CircuitBreakerAIProvider(delegate);

    const result = await guarded.complete(REQUEST);

    expect(result).toEqual(response('openai'));
    expect(delegate.complete).toHaveBeenCalledWith(REQUEST);
    expect(guarded.getBreakerMetrics().state).toBe(CircuitState.Closed);
  });

  it('short-circuits with CircuitOpenError once OPEN, without calling the delegate', async () => {
    const delegate = stubProvider('gemini', () => Promise.reject(new Error('vendor down')));
    const guarded = new CircuitBreakerAIProvider(delegate, { failureThreshold: 2 });

    await expect(guarded.complete(REQUEST)).rejects.toThrow('vendor down');
    await expect(guarded.complete(REQUEST)).rejects.toThrow('vendor down'); // trips OPEN
    expect(guarded.getBreakerMetrics().state).toBe(CircuitState.Open);
    expect(delegate.complete).toHaveBeenCalledTimes(2);

    // Next call is short-circuited: the delegate is NOT invoked again.
    await expect(guarded.complete(REQUEST)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(delegate.complete).toHaveBeenCalledTimes(2);
  });

  it('names the breaker after the provider kind by default', async () => {
    const delegate = stubProvider('openai', () => Promise.reject(new Error('x')));
    const guarded = new CircuitBreakerAIProvider(delegate, { failureThreshold: 1 });
    await expect(guarded.complete(REQUEST)).rejects.toThrow('x');
    expect(guarded.getBreakerMetrics().name).toBe('ai:openai');
  });
});
