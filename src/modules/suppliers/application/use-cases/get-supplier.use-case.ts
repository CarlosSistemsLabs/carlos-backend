import { NotFoundError } from '@domain/errors/index.js';
import type { ISupplierRepository } from '../../domain/repositories/supplier-repository.js';
import {
  toSupplierOutput,
  type GetSupplierInputDto,
  type SupplierOutput,
} from '../dto/supplier-dtos.js';

/**
 * Reads a single supplier by id (Requirement 9.1).
 *
 * The supplier is loaded by id and its tenant ownership is verified: a missing
 * (soft-deleted) supplier or one owned by another tenant yields a 404 rather
 * than leaking cross-tenant existence (Requirement 1.5). This thin read use
 * case keeps the presentation layer free of repository access
 * (Clean Architecture, Requirement 3.2).
 */
export class GetSupplierUseCase {
  constructor(private readonly suppliers: ISupplierRepository) {}

  async execute(input: GetSupplierInputDto): Promise<SupplierOutput> {
    const supplier = await this.suppliers.findById(input.id);
    if (supplier === null || supplier.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Supplier', input.id);
    }
    return toSupplierOutput(supplier);
  }
}
