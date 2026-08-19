import type { DomainEvent } from './domain-event.js';

/**
 * A subscriber invoked when an event it is registered for is published. May be
 * synchronous or asynchronous; the bus awaits the returned promise (if any)
 * before considering the dispatch of that handler complete.
 */
export type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => void | Promise<void>;

/** Cancels a subscription created via {@link IEventBus.subscribe}. Idempotent. */
export type Unsubscribe = () => void;

/**
 * In-process event bus port for inter-module communication (Requirement 3.5).
 *
 * Modules stay loosely coupled by publishing/subscribing to {@link DomainEvent}
 * instances rather than importing each other's internals: a producer (e.g. the
 * Sales module) publishes a `SaleCompleted` event and any number of consumers
 * (e.g. the Stock module) react, without the producer knowing who listens. The
 * domain declares only this port; the concrete transport lives in the
 * infrastructure layer (Clean Architecture, Requirement 3.2).
 */
export interface IEventBus {
  /**
   * Registers `handler` for every event whose {@link DomainEvent.eventName}
   * equals `eventName`. Returns a function that removes the subscription.
   */
  subscribe<E extends DomainEvent = DomainEvent>(
    eventName: string,
    handler: EventHandler<E>,
  ): Unsubscribe;

  /**
   * Dispatches `event` to all handlers registered for its
   * {@link DomainEvent.eventName}. Handlers are isolated: one throwing does not
   * prevent the others from running (see the concrete implementation for how
   * failures are surfaced). Resolves once every handler has settled.
   */
  publish(event: DomainEvent): Promise<void>;
}
