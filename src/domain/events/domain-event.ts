import { randomUUID } from 'node:crypto';
import type { UUID } from '@shared/types/index.js';

/**
 * Base class for all domain events.
 *
 * Domain events capture something meaningful that happened in the domain. They
 * are emitted by aggregates and dispatched without coupling the domain to any
 * infrastructure (Requirement 3.5). Each event records when it occurred and the
 * aggregate it originated from.
 */
export abstract class DomainEvent {
  /** Unique identity of this event occurrence. */
  public readonly eventId: UUID;

  /** The moment the event occurred. */
  public readonly occurredOn: Date;

  /** Identity of the aggregate that produced the event. */
  public readonly aggregateId: UUID;

  protected constructor(aggregateId: UUID, occurredOn?: Date) {
    this.eventId = randomUUID();
    this.aggregateId = aggregateId;
    this.occurredOn = occurredOn ?? new Date();
  }

  /**
   * The stable name used to route and subscribe to this event.
   */
  public abstract eventName(): string;
}
