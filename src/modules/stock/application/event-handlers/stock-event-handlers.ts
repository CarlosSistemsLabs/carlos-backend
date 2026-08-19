import type { IEventBus, Unsubscribe } from '@domain/events/event-bus.js';
import {
  PurchaseCompletedEvent,
  SaleCompletedEvent,
  type StockAffectingItem,
} from '@domain/events/index.js';
import { InsufficientStockError } from '../../domain/errors/stock-errors.js';
import type { RecordStockMovementUseCase } from '../use-cases/record-stock-movement.use-case.js';

/**
 * Minimal structured-logging surface the stock event handlers need. Kept local
 * so the module doesn't depend on another module's logger; the composition root
 * supplies a concrete implementation (e.g. Fastify's `app.log`).
 */
export interface StockEventLogger {
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

/**
 * Stock module's consumer side of the event-driven inter-module communication
 * (design "Event-Driven Communication", Requirement 9.1).
 *
 * It subscribes to the shared integration events raised by other modules and
 * translates each affected line into a referenced stock movement via
 * {@link RecordStockMovementUseCase}:
 * - `SaleCompleted`     → one `OUT` per item, referenced `sale:<saleId>`.
 * - `PurchaseCompleted` → one `IN`  per item, referenced `purchase:<purchaseId>`.
 *
 * The **producers** (Sales task 19.2, Purchases task 21.2) do not yet exist;
 * this wires the consumer + the bus so those tasks only need to publish.
 *
 * ### Insufficient-stock-on-sale behaviour
 * A sale is already finalised by the time `SaleCompleted` is observed, so a
 * decrement that would drive a balance negative ({@link InsufficientStockError})
 * must not throw back through the bus and cannot be "undone" here. The chosen
 * behaviour is **log-and-continue**: the offending item is logged as a warning
 * for manual reconciliation/back-order follow-up, and the remaining items are
 * still processed so one bad line never blocks the rest. Purchases (inbound)
 * cannot under-run, so their handler lets unexpected errors propagate to the
 * bus for isolation/reporting.
 */
export class StockEventHandlers {
  constructor(
    private readonly recordMovement: RecordStockMovementUseCase,
    private readonly logger: StockEventLogger,
  ) {}

  /**
   * Registers this consumer's subscriptions on the bus. Returns a disposer that
   * removes them all (useful for tests and graceful shutdown).
   */
  register(bus: IEventBus): Unsubscribe {
    const unsubscribers: Unsubscribe[] = [
      bus.subscribe<SaleCompletedEvent>(SaleCompletedEvent.EVENT_NAME, (event) =>
        this.onSaleCompleted(event),
      ),
      bus.subscribe<PurchaseCompletedEvent>(PurchaseCompletedEvent.EVENT_NAME, (event) =>
        this.onPurchaseCompleted(event),
      ),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }

  /** Decrements stock for every sold line, referenced `sale:<saleId>`. */
  async onSaleCompleted(event: SaleCompletedEvent): Promise<void> {
    for (const item of event.items) {
      try {
        await this.recordMovement.execute({
          tenantId: event.tenantId,
          productId: item.productId,
          branchId: this.branchOf(item),
          type: 'OUT',
          quantity: item.quantity,
          reference: `sale:${event.saleId}`,
        });
      } catch (error) {
        if (error instanceof InsufficientStockError) {
          // Sale already committed: record the shortfall for reconciliation and
          // keep processing the remaining items (documented log-and-continue).
          this.logger.warn(
            {
              tenantId: event.tenantId,
              saleId: event.saleId,
              productId: item.productId,
              branchId: this.branchOf(item),
              requested: item.quantity,
            },
            'Insufficient stock while applying a completed sale; movement skipped for reconciliation',
          );
          continue;
        }
        throw error;
      }
    }
  }

  /** Increments stock for every purchased line, referenced `purchase:<purchaseId>`. */
  async onPurchaseCompleted(event: PurchaseCompletedEvent): Promise<void> {
    for (const item of event.items) {
      await this.recordMovement.execute({
        tenantId: event.tenantId,
        productId: item.productId,
        branchId: this.branchOf(item),
        type: 'IN',
        quantity: item.quantity,
        reference: `purchase:${event.purchaseId}`,
      });
    }
  }

  private branchOf(item: StockAffectingItem): string | null {
    return item.branchId ?? null;
  }
}
