import type { Nullable, UUID } from '@shared/types/index.js';
import { DomainEvent } from '../domain-event.js';

/**
 * A line item on a completed document that affects on-hand stock. Shared by the
 * sale/purchase integration events so consumers apply one movement per item.
 */
export interface StockAffectingItem {
  /** The product whose balance changes. */
  productId: UUID;
  /** Units sold/purchased. Always a positive integer. */
  quantity: number;
  /** Branch the movement applies to; `null`/omitted targets the tenant-wide balance. */
  branchId?: Nullable<UUID>;
}

/** Payload required to raise a {@link SaleCompletedEvent}. */
export interface SaleCompletedPayload {
  tenantId: UUID;
  saleId: UUID;
  items: StockAffectingItem[];
}

/**
 * Integration event published when a sale is finalised (produced by the Sales
 * module in task 19.2). It is defined here in the shared domain-events kernel —
 * rather than inside the Sales module — so both the producer and its consumers
 * (the Stock module decrements inventory on this event, task 15.2) can import
 * the contract without creating a module-to-module dependency.
 *
 * The Stock module records one `OUT` movement per {@link items} entry,
 * referenced as `sale:<saleId>`.
 */
export class SaleCompletedEvent extends DomainEvent {
  /** The stable name used to subscribe to this event. */
  public static readonly EVENT_NAME = 'SaleCompleted';

  public readonly tenantId: UUID;
  public readonly saleId: UUID;
  public readonly items: readonly StockAffectingItem[];

  constructor(payload: SaleCompletedPayload, occurredOn?: Date) {
    super(payload.saleId, occurredOn);
    this.tenantId = payload.tenantId;
    this.saleId = payload.saleId;
    this.items = payload.items;
  }

  public override eventName(): string {
    return SaleCompletedEvent.EVENT_NAME;
  }
}
