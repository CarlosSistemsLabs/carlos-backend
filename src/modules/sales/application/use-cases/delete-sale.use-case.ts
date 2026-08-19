import { NotFoundError } from '@domain/errors/index.js';
import type { ISaleRepository } from '../../domain/repositories/sale-repository.js';
import type { DeleteSaleInputDto } from '../dto/sale-dtos.js';

/**
 * Soft-deletes a sale (Requirement 9.4).
 *
 * The sale is loaded first so a missing (or cross-tenant) id yields a 404 rather
 * than silently succeeding (Requirement 1.5). Deletion stamps `deletedAt` via
 * the repository; the row is retained for audit/restore and excluded from
 * subsequent reads.
 *
 * ### Stock reversal is deliberately NOT performed here (deferred)
 * Deleting (or cancelling) a `completed` sale does **not** restore the stock its
 * `SaleCompleted` event decremented. Reversal is a genuine compensating action
 * that belongs in the Stock module — it must record an explicit `IN`
 * (compensating) movement referenced to the sale so the audit trail stays
 * truthful, not silently mutate balances. Wiring that requires a
 * `SaleCancelled`/`SaleDeleted` StockAffecting event and a matching consumer,
 * which is out of scope for the endpoint task and tracked as a follow-up
 * (task 19.4 covers stock-reversal testing). Until then, reversing stock for a
 * voided completed sale is a manual reconciliation. Keeping it explicit avoids
 * shipping a half-correct auto-reversal that corrupts the movement ledger.
 */
export class DeleteSaleUseCase {
  constructor(private readonly sales: ISaleRepository) {}

  async execute(input: DeleteSaleInputDto): Promise<void> {
    const existing = await this.sales.findById(input.id);
    if (existing === null || existing.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Sale', input.id);
    }

    await this.sales.softDelete(existing.id);
  }
}
