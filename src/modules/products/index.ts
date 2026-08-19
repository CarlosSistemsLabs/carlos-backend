/**
 * Public façade for the Products module.
 *
 * Other modules and the composition root MUST consume product capabilities
 * through this barrel rather than reaching into internals (module boundaries,
 * Façade pattern). It exposes the domain layer (entities, value objects, errors
 * and repository ports), the application use cases + DTOs (task 13.2) and the
 * concrete Prisma repositories. HTTP endpoints (task 13.3) are re-exported here
 * once added.
 */

// Use cases (application entry points)
export { CreateProductUseCase } from './application/use-cases/create-product.use-case.js';
export { UpdateProductUseCase } from './application/use-cases/update-product.use-case.js';
export { DeleteProductUseCase } from './application/use-cases/delete-product.use-case.js';
export { GetProductUseCase } from './application/use-cases/get-product.use-case.js';
export { ListProductsUseCase } from './application/use-cases/list-products.use-case.js';
export { SearchProductsUseCase } from './application/use-cases/search-products.use-case.js';

// Category use cases (application entry points)
export { CreateCategoryUseCase } from './application/use-cases/create-category.use-case.js';
export { UpdateCategoryUseCase } from './application/use-cases/update-category.use-case.js';
export { DeleteCategoryUseCase } from './application/use-cases/delete-category.use-case.js';
export { GetCategoryUseCase } from './application/use-cases/get-category.use-case.js';
export { ListCategoriesUseCase } from './application/use-cases/list-categories.use-case.js';
export { GetCategoryTreeUseCase } from './application/use-cases/get-category-tree.use-case.js';

// DTOs + mappers
export {
  DEFAULT_PRODUCT_CURRENCY,
  normalizePagination,
  toProductOutput,
  toPagedProductOutput,
  type CreateProductInputDto,
  type UpdateProductInputDto,
  type DeleteProductInputDto,
  type GetProductInputDto,
  type ListProductsInputDto,
  type SearchProductsInputDto,
  type ProductOutput,
  type PageMeta,
  type PagedResult,
  type NormalizedPagination,
} from './application/dto/product-dtos.js';

// Category DTOs + mappers
export {
  buildCategoryTree,
  toCategoryOutput,
  type CreateCategoryInputDto,
  type UpdateCategoryInputDto,
  type DeleteCategoryInputDto,
  type GetCategoryInputDto,
  type ListCategoriesInputDto,
  type GetCategoryTreeInputDto,
  type CategoryOutput,
  type CategoryTreeNode,
} from './application/dto/category-dtos.js';

// Domain entities
export {
  Product,
  DEFAULT_PRODUCT_UNIT,
  MIN_TAX_RATE,
  MAX_TAX_RATE,
  type ProductProps,
  type CreateProductInput,
} from './domain/entities/product.js';
export {
  Category,
  type CategoryProps,
  type CreateCategoryInput,
} from './domain/entities/category.js';

// Value objects
export { Money, MONEY_DECIMAL_PLACES } from './domain/value-objects/money.js';
export { Sku, SKU_MAX_LENGTH } from './domain/value-objects/sku.js';

// Errors
export {
  InvalidPriceError,
  InvalidCostError,
  CurrencyMismatchError,
  SelfParentCategoryError,
} from './domain/errors/product-errors.js';

// Repository ports (implemented by infrastructure)
export type {
  IProductRepository,
  ProductFilters,
  ProductQuery,
  ProductSort,
  ProductSortField,
} from './domain/repositories/product-repository.js';
export type { ICategoryRepository } from './domain/repositories/category-repository.js';

// Infrastructure implementations
export {
  PrismaProductRepository,
  type ProductPrismaClient,
  type ProductModelDelegate,
  type ProductRow,
  type DecimalLike,
} from './infrastructure/prisma-product-repository.js';
export {
  PrismaCategoryRepository,
  type CategoryPrismaClient,
  type CategoryModelDelegate,
  type CategoryRow,
} from './infrastructure/prisma-category-repository.js';
