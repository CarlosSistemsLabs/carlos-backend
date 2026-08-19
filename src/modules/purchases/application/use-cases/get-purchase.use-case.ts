import { NotFoundError } from '@domain/errors/index.js';
import type { IPurchaseRepository } from '../../domain/repositories/purchase-repository.js';
import {
  toPurchaseOutput,
  type GetPurchaseInputDto,
  type PurchaseOutput,
} from '../dto/purchase-dtos.js';

/**
 * Reads a single purchase by id, including its line items (Requirement 10.3).
 *
 * The purchase is loaded by id (the repository already fetches its
 * `PurchaseDetail` lines) and its tenant ownership is verified: a missing
 * (soft-deleted) purchase or one owned by another tenant yields a 404 rather
 * than leaking cross-tenant existence (Requirement 1.5). This thin read use case
 * keeps the presentation layer free of repository access (Clean Architecture,
 * Requirement 3.2). Mirrors `GetSaleUseCase`.
 */
export class GetPurchaseUseCase {
  constructor(private readonly purchases: IPurchaseRepository) {}

  async execute(input: GetPurchaseInputDto): Promise<PurchaseOutput> {
    const purchase = await this.purchases.findById(input.id);
    if (purchase === null || purchase.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Purchase', input.id);
    }
    return toPurchaseOutput(purchase);
  }
}
