import type { UUID } from '@shared/types/index.js';
import { DomainEvent } from '../domain-event.js';
import type { StockAffectingItem } from './sale-completed.event.js';

/** Payload required to raise a {@link PurchaseCompletedEvent}. */
export interface PurchaseCompletedPayload {
  tenantId: UUID;
  purchaseId: UUID;
  items: StockAffectingItem[];
}

/**
 * Integration event published when a purchase is finalised (produced by the
 * Purchases module in task 21.2). Like {@link SaleCompletedEvent} it lives in
 * the shared domain-events kernel so producer and consumers share the contract
 * without a module-to-module dependency.
 *
 * The Stock module records one `IN` movement per {@link items} entry,
 * referenced as `purchase:<purchaseId>`.
 */
export class PurchaseCompletedEvent extends DomainEvent {
  /** The stable name used to subscribe to this event. */
  public static readonly EVENT_NAME = 'PurchaseCompleted';

  public readonly tenantId: UUID;
  public readonly purchaseId: UUID;
  public readonly items: readonly StockAffectingItem[];

  constructor(payload: PurchaseCompletedPayload, occurredOn?: Date) {
    super(payload.purchaseId, occurredOn);
    this.tenantId = payload.tenantId;
    this.purchaseId = payload.purchaseId;
    this.items = payload.items;
  }

  public override eventName(): string {
    return PurchaseCompletedEvent.EVENT_NAME;
  }
}
