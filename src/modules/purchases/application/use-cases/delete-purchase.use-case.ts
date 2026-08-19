import { NotFoundError } from '@domain/errors/index.js';
import type { IPurchaseRepository } from '../../domain/repositories/purchase-repository.js';
import type { DeletePurchaseInputDto } from '../dto/purchase-dtos.js';

/**
 * Soft-deletes a purchase (Requirement 9.4).
 *
 * The purchase is loaded first so a missing (or cross-tenant) id yields a 404
 * rather than silently succeeding (Requirement 1.5). Deletion stamps
 * `deletedAt` via the repository; the row is retained for audit/restore and
 * excluded from subsequent reads.
 *
 * ### Stock reversal is deliberately NOT performed here (deferred)
 * Deleting (or cancelling) a `completed` purchase does **not** reverse the stock
 * its `PurchaseCompleted` event incremented. Reversal is a genuine compensating
 * action that belongs in the Stock module — it must record an explicit `OUT`
 * (compensating) movement referenced to the purchase so the audit trail stays
 * truthful, not silently mutate balances. Wiring that requires a
 * `PurchaseCancelled`/`PurchaseDeleted` StockAffecting event and a matching
 * consumer, which is out of scope for the endpoint task and tracked as a
 * follow-up (mirrors the same deferral documented on `DeleteSaleUseCase`). Until
 * then, reversing stock for a voided completed purchase is a manual
 * reconciliation. Keeping it explicit avoids shipping a half-correct
 * auto-reversal that corrupts the movement ledger.
 */
export class DeletePurchaseUseCase {
  constructor(private readonly purchases: IPurchaseRepository) {}

  async execute(input: DeletePurchaseInputDto): Promise<void> {
    const existing = await this.purchases.findById(input.id);
    if (existing === null || existing.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Purchase', input.id);
    }

    await this.purchases.softDelete(existing.id);
  }
}
