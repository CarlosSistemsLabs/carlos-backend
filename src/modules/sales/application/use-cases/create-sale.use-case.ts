import { NotFoundError } from '@domain/errors/index.js';
import type { IEventBus } from '@domain/events/index.js';
import { Sale } from '../../domain/entities/sale.js';
import { SaleDetail } from '../../domain/entities/sale-detail.js';
import { EmptySaleError } from '../../domain/errors/sale-errors.js';
import type { ISaleUnitOfWork } from '../../domain/repositories/sale-unit-of-work.js';
import type { ISaleProductReader } from '../../domain/ports/sale-product-reader.js';
import type { ISaleCustomerReader } from '../../domain/ports/sale-customer-reader.js';
import {
  DEFAULT_SALE_CURRENCY,
  toSaleOutput,
  type CreateSaleInputDto,
  type SaleOutput,
} from '../dto/sale-dtos.js';

/**
 * Creates a sale within a tenant (Requirement 9.1).
 *
 * Responsibilities:
 * 1. Validate the request has at least one line ({@link EmptySaleError}).
 * 2. Verify the customer exists for the tenant (via {@link ISaleCustomerReader}).
 * 3. Resolve **authoritative** unit price + tax rate for every product from the
 *    catalogue (via {@link ISaleProductReader}) and build the line items —
 *    client input carries only `productId` + `quantity`, never a price, so the
 *    computed totals cannot be tampered with.
 * 4. Generate a unique per-tenant sale number and persist the header + lines
 *    **atomically** inside a single transaction ({@link ISaleUnitOfWork}), so a
 *    partial write can never occur and the sale number is allocated in the same
 *    commit that inserts it.
 *
 * Subtotals, tax and totals are derived by the {@link Sale}/{@link SaleDetail}
 * aggregates using integer {@link import('@shared/value-objects/money.js').Money}
 * math, so there is no floating-point drift.
 *
 * **Stock is decremented reactively, not here.** Completing the sale buffers a
 * `SaleCompleted` domain event on the aggregate; this use case publishes that
 * event on the {@link IEventBus} and the Stock module reacts (records one `OUT`
 * movement per line, referenced `sale:<saleId>`). The Sales module never imports
 * the Stock module — the shared integration event is the only coupling.
 *
 * ### Publish-after-commit (consistency trade-off)
 * The buffered events are pulled and published **after** the unit-of-work
 * transaction commits, never inside it. This guarantees a sale that rolls back
 * can never decrement stock (no phantom `OUT` movement for a sale that does not
 * durably exist). The cost is the usual dual-write gap: if the process dies
 * between commit and publish, the `SaleCompleted` event is lost (at-most-once in
 * that crash window). This is acceptable today because the bus is an in-process,
 * synchronous {@link InMemoryEventBus}; the documented future hardening is a
 * transactional **outbox** (persist the event in the same commit, relay it
 * asynchronously) which upgrades delivery to at-least-once without touching this
 * call site. The in-memory bus is also **error-isolated**: a failing stock
 * handler is routed to the bus error sink and never propagates back here, so a
 * downstream reaction failure cannot fail an already-committed sale.
 */
export class CreateSaleUseCase {
  constructor(
    private readonly unitOfWork: ISaleUnitOfWork,
    private readonly products: ISaleProductReader,
    private readonly customers: ISaleCustomerReader,
    private readonly eventBus: IEventBus,
  ) {}

  async execute(input: CreateSaleInputDto): Promise<SaleOutput> {
    if (input.items.length === 0) {
      throw new EmptySaleError();
    }

    const currency = input.currency ?? DEFAULT_SALE_CURRENCY;

    // The customer must exist for this tenant (foreign-key precondition).
    const customerExists = await this.customers.exists(input.tenantId, input.customerId);
    if (!customerExists) {
      throw NotFoundError.forEntity('Customer', input.customerId);
    }

    // Resolve authoritative pricing and build the line items up front (outside
    // the transaction, since these are read-only catalogue lookups).
    const lines: SaleDetail[] = [];
    for (const item of input.items) {
      const pricing = await this.products.findPricing(input.tenantId, item.productId);
      if (pricing === null) {
        throw NotFoundError.forEntity('Product', item.productId);
      }
      lines.push(
        SaleDetail.create({
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: pricing.unitPrice,
          taxRate: pricing.taxRate,
        }),
      );
    }

    // Allocate the sale number and insert the aggregate atomically.
    const created = await this.unitOfWork.execute(async ({ sales }) => {
      const saleNumber = await sales.nextSaleNumber(input.tenantId);

      const sale = Sale.create({
        tenantId: input.tenantId,
        customerId: input.customerId,
        userId: input.userId,
        saleNumber,
        currency,
        branchId: input.branchId ?? null,
        notes: input.notes ?? null,
        items: lines,
        ...(input.saleDate !== undefined ? { saleDate: input.saleDate } : {}),
      });

      // Default to a completed sale (buffers the SaleCompleted event); a draft
      // stays open and emits no event.
      if ((input.status ?? 'completed') === 'completed') {
        sale.complete();
      }

      return sales.create(sale);
    });

    // Publish AFTER the commit above: a rolled-back sale throws out of
    // `unitOfWork.execute` and never reaches here, so stock is only ever
    // decremented for a durably-persisted sale. A draft buffers no events, so
    // this is a no-op for drafts. The in-memory bus isolates handler failures,
    // so a stock-side error cannot fail this already-committed sale.
    const events = created.pullDomainEvents();
    for (const event of events) {
      await this.eventBus.publish(event);
    }

    return toSaleOutput(created);
  }
}
