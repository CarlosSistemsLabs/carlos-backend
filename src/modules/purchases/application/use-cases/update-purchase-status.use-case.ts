import { NotFoundError } from '@domain/errors/index.js';
import type { IEventBus } from '@domain/events/index.js';
import type { Purchase } from '../../domain/entities/purchase.js';
import type { IPurchaseRepository } from '../../domain/repositories/purchase-repository.js';
import { assertTransition } from '../../domain/value-objects/purchase-status.js';
import {
  toPurchaseOutput,
  type UpdatePurchaseStatusInputDto,
  type PurchaseOutput,
} from '../dto/purchase-dtos.js';

/**
 * Transitions a purchase to a new lifecycle status (Requirement 10.3).
 *
 * The purchase is loaded by id (with its lines) and its tenant ownership is
 * verified: a missing (soft-deleted) or cross-tenant purchase yields a 404
 * rather than leaking existence (Requirement 1.5).
 *
 * ### Transition is driven through the aggregate (not a bare column write)
 * Rather than blindly writing the `status` column, the requested status is
 * applied through the {@link Purchase} aggregate so the state machine and its
 * side effects stay authoritative and consistent with {@link
 * CreatePurchaseUseCase}:
 *
 * - `completed` → {@link Purchase.complete} guards the `draft → completed`
 *   transition, enforces the non-empty invariant and **buffers a
 *   `PurchaseCompleted` event**. Publishing it here (post-persist) drives the
 *   same stock increment that creating an already-completed purchase does, so a
 *   purchase opened as a `draft` and later completed through this endpoint still
 *   increments inventory exactly once.
 * - `cancelled` → {@link Purchase.cancel} guards the transition (`draft →
 *   cancelled` or `completed → cancelled`; an already-cancelled purchase is
 *   rejected).
 * - `draft` is never a legal target (no transition leads back to `draft`), so
 *   {@link assertTransition} rejects it up front.
 *
 * Any illegal transition raises {@link InvalidPurchaseStatusTransitionError} (a
 * {@link BusinessRuleError} → HTTP 422) before any write occurs.
 *
 * ### Publish-after-commit (consistency trade-off)
 * The status is persisted via {@link IPurchaseRepository.updateStatus} first;
 * the buffered domain events are pulled and published on the {@link IEventBus}
 * **only after** that write resolves, mirroring {@link CreatePurchaseUseCase}.
 * This guarantees stock is never incremented for a status change that failed to
 * persist. The in-memory bus isolates handler failures, so a downstream stock
 * reaction cannot fail an already-committed status change. `cancel` buffers no
 * event, so no stock is reversed here — reversing stock on cancellation of a
 * completed purchase is a deferred concern (see {@link DeletePurchaseUseCase}).
 * Mirrors `UpdateSaleStatusUseCase`.
 */
export class UpdatePurchaseStatusUseCase {
  constructor(
    private readonly purchases: IPurchaseRepository,
    private readonly eventBus: IEventBus,
  ) {}

  async execute(input: UpdatePurchaseStatusInputDto): Promise<PurchaseOutput> {
    const purchase = await this.purchases.findById(input.id);
    if (purchase === null || purchase.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Purchase', input.id);
    }

    this.applyTransition(purchase, input.status);

    await this.purchases.updateStatus(purchase.id, purchase.status);

    // Publish AFTER the status write persists: a failed write throws above and
    // never reaches here, so stock is only ever incremented for a durably
    // persisted completion. `cancel` buffers no events (no-op loop).
    const events = purchase.pullDomainEvents();
    for (const event of events) {
      await this.eventBus.publish(event);
    }

    return toPurchaseOutput(purchase);
  }

  /**
   * Applies the requested status through the aggregate's state machine. Throws
   * {@link InvalidPurchaseStatusTransitionError} for any illegal transition.
   */
  private applyTransition(purchase: Purchase, target: UpdatePurchaseStatusInputDto['status']): void {
    switch (target) {
      case 'completed':
        purchase.complete();
        return;
      case 'cancelled':
        purchase.cancel();
        return;
      default:
        // `draft` (or any non-terminal target) is never reachable — surface the
        // same forbidden-transition error the aggregate would raise.
        assertTransition(purchase.status, target);
    }
  }
}
