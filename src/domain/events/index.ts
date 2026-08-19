export { DomainEvent } from './domain-event.js';
export type { IEventBus, EventHandler, Unsubscribe } from './event-bus.js';
export {
  SaleCompletedEvent,
  type SaleCompletedPayload,
  type StockAffectingItem,
} from './integration/sale-completed.event.js';
export {
  PurchaseCompletedEvent,
  type PurchaseCompletedPayload,
} from './integration/purchase-completed.event.js';
