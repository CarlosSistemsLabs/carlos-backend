import { NotFoundError } from '@domain/errors/index.js';
import type { ISaleRepository } from '../../domain/repositories/sale-repository.js';
import { toSaleOutput, type GetSaleInputDto, type SaleOutput } from '../dto/sale-dtos.js';

/**
 * Reads a single sale by id, including its line items (Requirement 9.1).
 *
 * The sale is loaded by id (the repository already fetches its `SaleDetail`
 * lines) and its tenant ownership is verified: a missing (soft-deleted) sale or
 * one owned by another tenant yields a 404 rather than leaking cross-tenant
 * existence (Requirement 1.5). This thin read use case keeps the presentation
 * layer free of repository access (Clean Architecture, Requirement 3.2).
 */
export class GetSaleUseCase {
  constructor(private readonly sales: ISaleRepository) {}

  async execute(input: GetSaleInputDto): Promise<SaleOutput> {
    const sale = await this.sales.findById(input.id);
    if (sale === null || sale.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Sale', input.id);
    }
    return toSaleOutput(sale);
  }
}
