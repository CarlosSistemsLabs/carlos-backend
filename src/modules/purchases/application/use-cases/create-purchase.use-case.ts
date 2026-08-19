import { NotFoundError } from '@domain/errors/index.js';
import type { IEventBus } from '@domain/events/index.js';
import { Money } from '@shared/value-objects/money.js';
import { Purchase } from '../../domain/entities/purchase.js';
import { PurchaseDetail } from '../../domain/entities/purchase-detail.js';
import {
  EmptyPurchaseError,
  MissingProductCostError,
} from '../../domain/errors/purchase-errors.js';
import type { IPurchaseUnitOfWork } from '../../domain/repositories/purchase-unit-of-work.js';
import type { IPurchaseProductReader } from '../../domain/ports/purchase-product-reader.js';
import type { IPurchaseSupplierReader } from '../../domain/ports/purchase-supplier-reader.js';
import {
  DEFAULT_PURCHASE_CURRENCY,
  toPurchaseOutput,
  type CreatePurchaseInputDto,
  type PurchaseOutput,
} from '../dto/purchase-dtos.js';

/**
 * Creates a purchase within a tenant (Requirement 9.1, 10.3).
 *
 * Mirrors `CreateSaleUseCase` but records goods coming **in** from a supplier.
 * Responsibilities:
 * 1. Validate the request has at least one line ({@link EmptyPurchaseError}).
 * 2. Verify the supplier exists for the tenant (via {@link IPurchaseSupplierReader}).
 * 3. Resolve **authoritative** unit cost + tax rate for every product from the
 *    catalogue (via {@link IPurchaseProductReader}) and build the line items.
 *    The catalogue `Product.cost` is preferred; when it is `null` the use case
 *    falls back to a client-supplied `unitCost` on the line, and rejects the
 *    line with a {@link MissingProductCostError} when neither is available.
 * 4. Generate a unique per-tenant purchase number and persist the header +
 *    lines **atomically** inside a single transaction ({@link
 *    IPurchaseUnitOfWork}), so a partial write can never occur and the purchase
 *    number is allocated in the same commit that inserts it.
 *
 * Subtotals, tax and totals are derived by the {@link Purchase}/{@link
 * PurchaseDetail} aggregates using integer {@link Money} math, so there is no
 * floating-point drift.
 *
 * **Stock is incremented reactively, not here.** Completing the purchase buffers
 * a `PurchaseCompleted` domain event on the aggregate; this use case publishes
 * that event on the {@link IEventBus} **after** the transaction commits (task
 * 21.2 subscribes the Stock module to record one `IN` movement per line,
 * referenced `purchase:<purchaseId>`). Publishing post-commit guarantees a
 * rolled-back purchase can never increment stock; the in-memory bus isolates
 * handler failures so a downstream reaction cannot fail an already-committed
 * purchase. The Purchases module never imports the Stock module — the shared
 * integration event is the only coupling.
 */
export class CreatePurchaseUseCase {
  constructor(
    private readonly unitOfWork: IPurchaseUnitOfWork,
    private readonly products: IPurchaseProductReader,
    private readonly suppliers: IPurchaseSupplierReader,
    private readonly eventBus: IEventBus,
  ) {}

  async execute(input: CreatePurchaseInputDto): Promise<PurchaseOutput> {
    if (input.items.length === 0) {
      throw new EmptyPurchaseError();
    }

    const currency = input.currency ?? DEFAULT_PURCHASE_CURRENCY;

    // The supplier must exist for this tenant (foreign-key precondition).
    const supplierExists = await this.suppliers.exists(input.tenantId, input.supplierId);
    if (!supplierExists) {
      throw NotFoundError.forEntity('Supplier', input.supplierId);
    }

    // Resolve authoritative cost and build the line items up front (outside the
    // transaction, since these are read-only catalogue lookups).
    const lines: PurchaseDetail[] = [];
    for (const item of input.items) {
      const cost = await this.products.findCost(input.tenantId, item.productId);
      if (cost === null) {
        throw NotFoundError.forEntity('Product', item.productId);
      }

      // Prefer the authoritative catalogue cost; fall back to a client-supplied
      // override only when the catalogue has no recorded cost.
      const unitCost = cost.unitCost ?? this.resolveOverride(item.unitCost, currency);
      if (unitCost === null) {
        throw new MissingProductCostError(item.productId);
      }

      lines.push(
        PurchaseDetail.create({
          productId: item.productId,
          quantity: item.quantity,
          unitCost,
          taxRate: cost.taxRate,
        }),
      );
    }

    // Allocate the purchase number and insert the aggregate atomically.
    const created = await this.unitOfWork.execute(async ({ purchases }) => {
      const purchaseNumber = await purchases.nextPurchaseNumber(input.tenantId);

      const purchase = Purchase.create({
        tenantId: input.tenantId,
        supplierId: input.supplierId,
        userId: input.userId,
        purchaseNumber,
        currency,
        notes: input.notes ?? null,
        items: lines,
        ...(input.purchaseDate !== undefined ? { purchaseDate: input.purchaseDate } : {}),
      });

      // Default to a completed purchase (buffers the PurchaseCompleted event); a
      // draft stays open and emits no event.
      if ((input.status ?? 'completed') === 'completed') {
        purchase.complete();
      }

      return purchases.create(purchase);
    });

    // Publish AFTER the commit above: a rolled-back purchase throws out of
    // `unitOfWork.execute` and never reaches here, so stock is only ever
    // incremented for a durably-persisted purchase. A draft buffers no events.
    const events = created.pullDomainEvents();
    for (const event of events) {
      await this.eventBus.publish(event);
    }

    return toPurchaseOutput(created);
  }

  /** Builds a {@link Money} from a client cost override, or `null` when absent. */
  private resolveOverride(value: string | number | undefined, currency: string): Money | null {
    if (value === undefined) {
      return null;
    }
    return Money.fromDecimal(value, currency);
  }
}
