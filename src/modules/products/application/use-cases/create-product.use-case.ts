import { ConflictError, NotFoundError } from '@domain/errors/index.js';
import type { ICache } from '@application/ports/cache.js';
import { NoOpCache } from '@application/cache/no-op-cache.js';
import { VersionedListCache } from '@application/cache/query-cache.js';
import { PRODUCT_LIST_CACHE_NAMESPACE } from '@application/cache/cache-ttls.js';
import { Product } from '../../domain/entities/product.js';
import { Sku } from '../../domain/value-objects/sku.js';
import { Money } from '../../domain/value-objects/money.js';
import type { IProductRepository } from '../../domain/repositories/product-repository.js';
import type { ICategoryRepository } from '../../domain/repositories/category-repository.js';
import {
  DEFAULT_PRODUCT_CURRENCY,
  toProductOutput,
  type CreateProductInputDto,
  type ProductOutput,
} from '../dto/product-dtos.js';

/**
 * Creates a new product within a tenant (Requirements 9.1, 26.1).
 *
 * Enforces the cross-aggregate invariants the {@link Product} entity cannot see
 * on its own: the referenced category must exist for the same tenant, and the
 * SKU must be unique per tenant (`@@unique([tenantId, sku])`). Monetary inputs
 * arrive as decimal strings and are converted to {@link Money} so precision and
 * currency are handled consistently.
 *
 * **Cache invalidation (task 39.4, Requirement 26.1).** A new product changes
 * every product list/search result for the tenant, so after a successful
 * persist the tenant's product-list cache version is bumped, invalidating all
 * cached list/search permutations at once (see {@link VersionedListCache}).
 */
export class CreateProductUseCase {
  private readonly listCache: VersionedListCache;

  constructor(
    private readonly products: IProductRepository,
    private readonly categories: ICategoryRepository,
    cache: ICache = new NoOpCache(),
  ) {
    this.listCache = new VersionedListCache(cache, PRODUCT_LIST_CACHE_NAMESPACE, 0);
  }

  async execute(input: CreateProductInputDto): Promise<ProductOutput> {
    const currency = input.currency ?? DEFAULT_PRODUCT_CURRENCY;
    const sku = Sku.create(input.sku);

    // The category must exist and belong to the same tenant.
    const category = await this.categories.findById(input.categoryId);
    if (category === null || category.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Category', input.categoryId);
    }

    // Per-tenant SKU uniqueness (cross-aggregate invariant).
    const skuTaken = await this.products.existsBySku(input.tenantId, sku.value);
    if (skuTaken) {
      throw new ConflictError('A product with this SKU already exists', {
        field: 'sku',
        sku: sku.value,
      });
    }

    const product = Product.create({
      tenantId: input.tenantId,
      categoryId: input.categoryId,
      sku,
      name: input.name,
      description: input.description ?? null,
      price: Money.fromDecimal(input.price, currency),
      cost: input.cost === undefined || input.cost === null
        ? null
        : Money.fromDecimal(input.cost, currency),
      imageUrl: input.imageUrl ?? null,
      ...(input.taxRate !== undefined ? { taxRate: input.taxRate } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(input.minStock !== undefined ? { minStock: input.minStock } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    });

    const saved = await this.products.create(product);
    await this.listCache.invalidate(input.tenantId);
    return toProductOutput(saved);
  }
}
