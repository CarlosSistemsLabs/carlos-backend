import type { DomainEvent } from '@domain/events/index.js';
import type { EventHandler, IEventBus, Unsubscribe } from '@domain/events/event-bus.js';

/**
 * Invoked when a subscriber throws (or rejects) during {@link
 * InMemoryEventBus.publish}. Lets the composition root route handler failures to
 * a logger/monitoring sink without letting one bad handler abort the others.
 */
export type EventBusErrorHandler = (error: unknown, event: DomainEvent) => void;

/**
 * A minimal, dependency-free, in-process {@link IEventBus} (Requirement 3.5).
 *
 * Handlers are stored per event name and invoked on publish. Dispatch is
 * **error-isolated**: every subscriber runs even if a previous one throws, and
 * failures are surfaced through the optional {@link EventBusErrorHandler}
 * instead of propagating out of `publish`. This keeps inter-module reactions
 * (e.g. stock decrement on a completed sale) independent — one failing consumer
 * never blocks the rest — which matters for a modular monolith that may later
 * extract these consumers into separate services.
 *
 * The bus is intentionally synchronous/in-memory; a durable transport (outbox,
 * queue) can implement the same port later without touching producers or
 * consumers.
 */
export class InMemoryEventBus implements IEventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly onError: EventBusErrorHandler | undefined;

  constructor(onError?: EventBusErrorHandler) {
    this.onError = onError;
  }

  subscribe<E extends DomainEvent = DomainEvent>(
    eventName: string,
    handler: EventHandler<E>,
  ): Unsubscribe {
    // The public generic guarantees callers register a correctly-typed handler;
    // internally every handler is stored against the base event type, so the
    // cast is localised here rather than leaking into consumers.
    const generic = handler as EventHandler;
    let set = this.handlers.get(eventName);
    if (set === undefined) {
      set = new Set<EventHandler>();
      this.handlers.set(eventName, set);
    }
    set.add(generic);

    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      set.delete(generic);
      if (set.size === 0) {
        this.handlers.delete(eventName);
      }
    };
  }

  async publish(event: DomainEvent): Promise<void> {
    const set = this.handlers.get(event.eventName());
    if (set === undefined || set.size === 0) {
      return;
    }

    // Snapshot so handlers that (un)subscribe during dispatch don't mutate the
    // iteration, and run all of them regardless of individual failures. Wrapping
    // in `Promise.resolve().then` normalises synchronous throws into rejected
    // promises so a throwing handler cannot abort the dispatch loop.
    const results = await Promise.allSettled(
      [...set].map((handler) => Promise.resolve().then(() => handler(event))),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        if (this.onError !== undefined) {
          this.onError(result.reason, event);
        }
      }
    }
  }
}
