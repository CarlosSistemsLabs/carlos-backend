import type { DomainEvent } from '@domain/events/domain-event.js';
import { Entity } from './entity.js';

/**
 * Base class for aggregate roots.
 *
 * An aggregate root is an entity that serves as the entry point to a cluster of
 * domain objects and is responsible for recording {@link DomainEvent}s. Events
 * are buffered on the aggregate and later pulled by the application layer for
 * publication, keeping the domain free of infrastructure coupling
 * (Requirement 3.5).
 *
 * @typeParam TProps - The shape of the aggregate's attributes.
 */
export abstract class AggregateRoot<TProps> extends Entity<TProps> {
  private _domainEvents: DomainEvent[] = [];

  /** The events recorded since the last {@link pullDomainEvents} call. */
  public get domainEvents(): readonly DomainEvent[] {
    return this._domainEvents;
  }

  /** Records a domain event to be published later. */
  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  /** Discards all buffered domain events. */
  public clearDomainEvents(): void {
    this._domainEvents = [];
  }

  /**
   * Returns the buffered events and clears the buffer, transferring ownership
   * to the caller (typically the application layer for dispatch).
   */
  public pullDomainEvents(): DomainEvent[] {
    const events = this._domainEvents;
    this._domainEvents = [];
    return events;
  }
}
