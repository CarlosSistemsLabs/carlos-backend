import { ValidationError } from '@domain/errors/index.js';
import type { AdjustStockUseCase } from './adjust-stock.use-case.js';
import type { AdjustStockInputDto, AdjustStockOutput, RecordStockMovementInputDto } from '../dto/stock-dtos.js';

/**
 * Records a referenced stock movement (Requirement 9.1).
 *
 * This is the API other modules and event handlers use to apply a single-leg
 * movement tied to an originating document — for example a sale line becomes an
 * `OUT` referenced `sale:<id>`, a purchase line an `IN` referenced
 * `purchase:<id>`. Its distinguishing feature over a bare adjustment is the
 * **mandatory `reference`**, which threads the audit trail back to the document
 * that caused the change.
 *
 * It does **not** re-implement the balance-plus-movement transaction: it
 * composes {@link AdjustStockUseCase}, the single atomic inventory write path,
 * so the recorded movement and the balance update commit or roll back together.
 * An `OUT` beyond the available quantity therefore surfaces
 * `InsufficientStockError` from the underlying Stock aggregate and nothing is
 * persisted.
 */
export class RecordStockMovementUseCase {
  constructor(private readonly adjustStock: AdjustStockUseCase) {}

  async execute(input: RecordStockMovementInputDto): Promise<AdjustStockOutput> {
    const reference = input.reference?.trim();
    if (reference === undefined || reference === '') {
      throw new ValidationError('A stock movement reference is required', {
        reference: input.reference,
      });
    }

    const adjustInput: AdjustStockInputDto = {
      tenantId: input.tenantId,
      productId: input.productId,
      branchId: input.branchId ?? null,
      type: input.type,
      quantity: input.quantity,
      reference,
      notes: input.notes ?? null,
    };

    return this.adjustStock.execute(adjustInput);
  }
}
