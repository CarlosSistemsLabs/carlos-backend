import { NotFoundError } from '@domain/errors/index.js';
import type { IProductRepository } from '../../domain/repositories/product-repository.js';
import {
  toProductOutput,
  type GetProductInputDto,
  type ProductOutput,
} from '../dto/product-dtos.js';

/**
 * Reads a single product by id (Requirement 9.1).
 *
 * The product is loaded by id and its tenant ownership is verified: a missing
 * (soft-deleted) product or one owned by another tenant yields a 404 rather
 * than leaking cross-tenant existence (Requirement 1.5). This thin read use
 * case keeps the presentation layer free of repository access, mirroring the
 * other product use cases (Clean Architecture, Requirement 3.2).
 */
export class GetProductUseCase {
  constructor(private readonly products: IProductRepository) {}

  async execute(input: GetProductInputDto): Promise<ProductOutput> {
    const product = await this.products.findById(input.id);
    if (product === null || product.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Product', input.id);
    }
    return toProductOutput(product);
  }
}
