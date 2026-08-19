import { NotFoundError } from '@domain/errors/index.js';
import type { ISupplierRepository } from '../../domain/repositories/supplier-repository.js';
import type { DeleteSupplierInputDto } from '../dto/supplier-dtos.js';

/**
 * Soft-deletes a supplier (Requirement 9.4).
 *
 * The supplier is loaded first so a missing (or cross-tenant) id yields a 404
 * rather than silently succeeding. Deletion stamps `deletedAt` via the
 * repository; the row is retained for audit/restore and excluded from
 * subsequent reads.
 */
export class DeleteSupplierUseCase {
  constructor(private readonly suppliers: ISupplierRepository) {}

  async execute(input: DeleteSupplierInputDto): Promise<void> {
    const existing = await this.suppliers.findById(input.id);
    if (existing === null || existing.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Supplier', input.id);
    }

    await this.suppliers.softDelete(existing.id);
  }
}
