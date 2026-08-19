import { describe, it, expect } from 'vitest';
import { DomainEvent } from './domain-event.js';

class OrderPlaced extends DomainEvent {
  constructor(
    aggregateId: string,
    public readonly total: number,
    occurredOn?: Date,
  ) {
    super(aggregateId, occurredOn);
  }

  override eventName(): string {
    return 'OrderPlaced';
  }
}

describe('DomainEvent', () => {
  it('exposes the aggregate id it was created with', () => {
    const event = new OrderPlaced('agg-1', 50);
    expect(event.aggregateId).toBe('agg-1');
  });

  it('defaults occurredOn to the current time', () => {
    const before = Date.now();
    const event = new OrderPlaced('agg-1', 50);
    const after = Date.now();
    expect(event.occurredOn.getTime()).toBeGreaterThanOrEqual(before);
    expect(event.occurredOn.getTime()).toBeLessThanOrEqual(after);
  });

  it('respects an explicitly provided occurredOn', () => {
    const when = new Date('2024-01-01T00:00:00.000Z');
    const event = new OrderPlaced('agg-1', 50, when);
    expect(event.occurredOn).toBe(when);
  });

  it('generates a unique event id per occurrence', () => {
    const a = new OrderPlaced('agg-1', 50);
    const b = new OrderPlaced('agg-1', 50);
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('exposes a stable event name', () => {
    expect(new OrderPlaced('agg-1', 50).eventName()).toBe('OrderPlaced');
  });
});
