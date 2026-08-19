import { describe, expect, it, vi } from 'vitest';
import { DomainEvent } from '@domain/events/index.js';
import { InMemoryEventBus } from './in-memory-event-bus.js';

class TestEvent extends DomainEvent {
  static readonly EVENT_NAME = 'TestEvent';
  constructor(
    aggregateId: string,
    public readonly payload: string,
  ) {
    super(aggregateId);
  }
  override eventName(): string {
    return TestEvent.EVENT_NAME;
  }
}

class OtherEvent extends DomainEvent {
  static readonly EVENT_NAME = 'OtherEvent';
  constructor(aggregateId: string) {
    super(aggregateId);
  }
  override eventName(): string {
    return OtherEvent.EVENT_NAME;
  }
}

describe('InMemoryEventBus', () => {
  it('delivers a published event to a subscribed handler', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    bus.subscribe<TestEvent>(TestEvent.EVENT_NAME, handler);

    const event = new TestEvent('agg-1', 'hello');
    await bus.publish(event);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('invokes every handler registered for the same event', async () => {
    const bus = new InMemoryEventBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe(TestEvent.EVENT_NAME, first);
    bus.subscribe(TestEvent.EVENT_NAME, second);

    await bus.publish(new TestEvent('agg-1', 'x'));

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it('does not invoke handlers registered for a different event', async () => {
    const bus = new InMemoryEventBus();
    const other = vi.fn();
    bus.subscribe(OtherEvent.EVENT_NAME, other);

    await bus.publish(new TestEvent('agg-1', 'x'));

    expect(other).not.toHaveBeenCalled();
  });

  it('is a no-op when there are no subscribers', async () => {
    const bus = new InMemoryEventBus();
    await expect(bus.publish(new TestEvent('agg-1', 'x'))).resolves.toBeUndefined();
  });

  it('awaits asynchronous handlers before resolving', async () => {
    const bus = new InMemoryEventBus();
    let done = false;
    bus.subscribe(TestEvent.EVENT_NAME, async () => {
      await Promise.resolve();
      done = true;
    });

    await bus.publish(new TestEvent('agg-1', 'x'));
    expect(done).toBe(true);
  });

  it('isolates handler errors: one failing handler does not stop the others', async () => {
    const onError = vi.fn();
    const bus = new InMemoryEventBus(onError);
    const failing = vi.fn(() => {
      throw new Error('boom');
    });
    const healthy = vi.fn();
    bus.subscribe(TestEvent.EVENT_NAME, failing);
    bus.subscribe(TestEvent.EVENT_NAME, healthy);

    const event = new TestEvent('agg-1', 'x');
    await expect(bus.publish(event)).resolves.toBeUndefined();

    expect(healthy).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0]?.[1]).toBe(event);
  });

  it('reports rejected async handlers to the error handler', async () => {
    const onError = vi.fn();
    const bus = new InMemoryEventBus(onError);
    bus.subscribe(TestEvent.EVENT_NAME, async () => {
      await Promise.resolve();
      throw new Error('async boom');
    });

    await bus.publish(new TestEvent('agg-1', 'x'));
    expect(onError).toHaveBeenCalledOnce();
  });

  it('stops delivering to a handler after it unsubscribes', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe(TestEvent.EVENT_NAME, handler);

    await bus.publish(new TestEvent('agg-1', 'first'));
    unsubscribe();
    await bus.publish(new TestEvent('agg-1', 'second'));

    expect(handler).toHaveBeenCalledOnce();
  });

  it('unsubscribe is idempotent and safe to call twice', async () => {
    const bus = new InMemoryEventBus();
    const handler = vi.fn();
    const unsubscribe = bus.subscribe(TestEvent.EVENT_NAME, handler);
    unsubscribe();
    expect(() => unsubscribe()).not.toThrow();

    await bus.publish(new TestEvent('agg-1', 'x'));
    expect(handler).not.toHaveBeenCalled();
  });
});
