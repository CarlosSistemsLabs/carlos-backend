import { NotFoundError } from '@domain/errors/index.js';
import type { IEventBus } from '@domain/events/index.js';
import type { Sale } from '../../domain/entities/sale.js';
import type { ISaleRepository } from '../../domain/repositories/sale-repository.js';
import { assertTransition } from '../../domain/value-objects/sale-status.js';
import { toSaleOutput, type UpdateSaleStatusInputDto, type SaleOutput } from '../dto/sale-dtos.js';

/**
 * Transitions a sale to a new lifecycle status (Requirement 9.1).
 *
 * The sale is loaded by id (with its lines) and its tenant ownership is
 * verified: a missing (soft-deleted) or cross-tenant sale yields a 404 rather
 * than leaking existence (Requirement 1.5).
 *
 * ### Transition is driven through the aggregate (not a bare column write)
 * Rather than blindly writing the `status` column, the requested status is
 * applied through the {@link Sale} aggregate so the state machine and its side
 * effects stay authoritative and consistent with {@link CreateSaleUseCase}:
 *
 * - `completed` → {@link Sale.complete} guards the `draft → completed`
 *   transition, enforces the non-empty invariant and **buffers a
 *   `SaleCompleted` event**. Publishing it here (post-persist) drives the same
 *   stock decrement that creating an already-completed sale does, so a sale
 *   opened as a `draft` and later completed through this endpoint still
 *   decrements inventory exactly once.
 * - `cancelled` → {@link Sale.cancel} guards the transition (`draft → cancelled`
 *   or `completed → cancelled`; an already-cancelled sale is rejected).
 * - `draft` is never a legal target (no transition leads back to `draft`), so
 *   {@link assertTransition} rejects it up front.
 *
 * Any illegal transition raises {@link InvalidSaleStatusTransitionError} (a
 * {@link BusinessRuleError} → HTTP 422) before any write occurs.
 *
 * ### Publish-after-commit (consistency trade-off)
 * The status is persisted via {@link ISaleRepository.updateStatus} first; the
 * buffered domain events are pulled and published on the {@link IEventBus}
 * **only after** that write resolves, mirroring {@link CreateSaleUseCase}. This
 * guarantees stock is never decremented for a status change that failed to
 * persist. The in-memory bus isolates handler failures, so a downstream stock
 * reaction cannot fail an already-committed status change. `cancel` buffers no
 * event, so no stock is restored here — restoring stock on cancellation of a
 * completed sale is a deferred concern (see {@link DeleteSaleUseCase}).
 */
export class UpdateSaleStatusUseCase {
  constructor(
    private readonly sales: ISaleRepository,
    private readonly eventBus: IEventBus,
  ) {}

  async execute(input: UpdateSaleStatusInputDto): Promise<SaleOutput> {
    const sale = await this.sales.findById(input.id);
    if (sale === null || sale.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Sale', input.id);
    }

    this.applyTransition(sale, input.status);

    await this.sales.updateStatus(sale.id, sale.status);

    // Publish AFTER the status write persists: a failed write throws above and
    // never reaches here, so stock is only ever decremented for a durably
    // persisted completion. `cancel` buffers no events (no-op loop).
    const events = sale.pullDomainEvents();
    for (const event of events) {
      await this.eventBus.publish(event);
    }

    return toSaleOutput(sale);
  }

  /**
   * Applies the requested status through the aggregate's state machine. Throws
   * {@link InvalidSaleStatusTransitionError} for any illegal transition.
   */
  private applyTransition(sale: Sale, target: UpdateSaleStatusInputDto['status']): void {
    switch (target) {
      case 'completed':
        sale.complete();
        return;
      case 'cancelled':
        sale.cancel();
        return;
      default:
        // `draft` (or any non-terminal target) is never reachable — surface the
        // same forbidden-transition error the aggregate would raise.
        assertTransition(sale.status, target);
    }
  }
}
