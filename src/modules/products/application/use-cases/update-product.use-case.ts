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
  type UpdateProductInputDto,
  type ProductOutput,
} from '../dto/product-dtos.js';

/**
 * Updates an existing product (Requirements 9.1, 26.1).
 *
 * Loads the product (404 when missing or owned by another tenant), merges the
 * supplied changes and re-runs every {@link Product} invariant by rebuilding
 * the aggregate via {@link Product.create} — guaranteeing an update can never
 * leave a product in an invalid state (e.g. a non-positive price). When the SKU
 * changes, per-tenant uniqueness is re-checked (excluding the product itself);
 * when the category changes, the new category's existence is verified.
 *
 * **Cache invalidation (task 39.4, Requirement 26.1).** An update can change a
 * product's name, price, category or active flag — all of which affect cached
 * list/search results — so after a successful persist the tenant's product-list
 * cache version is bumped, invalidating every cached permutation at once (see
 * {@link VersionedListCache}).
 */
export class UpdateProductUseCase {
  private readonly listCache: VersionedListCache;

  constructor(
    private readonly products: IProductRepository,
    private readonly categories: ICategoryRepository,
    cache: ICache = new NoOpCache(),
  ) {
    this.listCache = new VersionedListCache(cache, PRODUCT_LIST_CACHE_NAMESPACE, 0);
  }

  async execute(input: UpdateProductInputDto): Promise<ProductOutput> {
    const currency = input.currency ?? DEFAULT_PRODUCT_CURRENCY;

    const existing = await this.products.findById(input.id);
    if (existing === null || existing.tenantId !== input.tenantId) {
      throw NotFoundError.forEntity('Product', input.id);
    }

    // Resolve the (possibly new) SKU and re-check uniqueness only when it moves.
    const nextSku = input.sku !== undefined ? Sku.create(input.sku) : existing.sku;
    if (nextSku.value !== existing.sku.value) {
      const skuTaken = await this.products.existsBySku(input.tenantId, nextSku.value, existing.id);
      if (skuTaken) {
        throw new ConflictError('A product with this SKU already exists', {
          field: 'sku',
          sku: nextSku.value,
        });
      }
    }

    // Verify the target category exists for the tenant when it changes.
    const nextCategoryId = input.categoryId ?? existing.categoryId;
    if (nextCategoryId !== existing.categoryId) {
      const category = await this.categories.findById(nextCategoryId);
      if (category === null || category.tenantId !== input.tenantId) {
        throw NotFoundError.forEntity('Category', nextCategoryId);
      }
    }

    const nextPrice =
      input.price !== undefined ? Money.fromDecimal(input.price, currency) : existing.price;
    const nextCost =
      input.cost === undefined
        ? existing.cost
        : input.cost === null
          ? null
          : Money.fromDecimal(input.cost, currency);

    const updated = Product.create(
      {
        tenantId: existing.tenantId,
        categoryId: nextCategoryId,
        sku: nextSku,
        name: input.name ?? existing.name,
        description: input.description === undefined ? existing.description : input.description,
        price: nextPrice,
        cost: nextCost,
        taxRate: input.taxRate ?? existing.taxRate,
        unit: input.unit ?? existing.unit,
        minStock: input.minStock ?? existing.minStock,
        isActive: input.isActive ?? existing.isActive,
        imageUrl: input.imageUrl === undefined ? existing.imageUrl : input.imageUrl,
      },
      existing.id,
    );

    const saved = await this.products.update(updated);
    await this.listCache.invalidate(input.tenantId);
    return toProductOutput(saved);
  }
}
