/**
 * Public façade for the Sales module.
 *
 * Other modules and the composition root MUST consume sales capabilities
 * through this barrel rather than reaching into internals (module boundaries,
 * Façade pattern). It exposes the domain layer (entities, value objects, errors,
 * repository ports and reader ports), the application use case + DTOs and the
 * concrete Prisma repository/unit-of-work/readers.
 *
 * Not yet wired here: publishing the buffered `SaleCompleted` event to drive the
 * stock decrement (task 19.2) and the HTTP endpoints (task 19.3).
 */

// Presentation (HTTP routes, task 19.3)
export {
  registerSaleRoutes,
  buildSaleUseCases,
  saleRoutesPlugin,
  type SaleRoutesOptions,
} from './presentation/sale.routes.js';

// Use cases (application entry points)
export { CreateSaleUseCase } from './application/use-cases/create-sale.use-case.js';
export { GetSaleUseCase } from './application/use-cases/get-sale.use-case.js';
export { ListSalesUseCase } from './application/use-cases/list-sales.use-case.js';
export { UpdateSaleStatusUseCase } from './application/use-cases/update-sale-status.use-case.js';
export { DeleteSaleUseCase } from './application/use-cases/delete-sale.use-case.js';

// DTOs + mappers
export {
  DEFAULT_SALE_CURRENCY,
  normalizePagination,
  toSaleOutput,
  toSaleLineOutput,
  toPagedSaleOutput,
  type CreateSaleInputDto,
  type CreateSaleLineInputDto,
  type GetSaleInputDto,
  type ListSalesInputDto,
  type UpdateSaleStatusInputDto,
  type DeleteSaleInputDto,
  type SaleOutput,
  type SaleLineOutput,
  type PageMeta,
  type PagedResult,
  type NormalizedPagination,
} from './application/dto/sale-dtos.js';

// Domain entities
export {
  Sale,
  type SaleProps,
  type CreateSaleInput,
  type SaleTotals,
} from './domain/entities/sale.js';
export {
  SaleDetail,
  MIN_LINE_TAX_RATE,
  MAX_LINE_TAX_RATE,
  type SaleDetailProps,
  type CreateSaleDetailInput,
} from './domain/entities/sale-detail.js';

// Value objects
export {
  SALE_STATUSES,
  DEFAULT_SALE_STATUS,
  isSaleStatus,
  assertSaleStatus,
  canTransition,
  assertTransition,
  type SaleStatus,
} from './domain/value-objects/sale-status.js';

// Errors
export {
  EmptySaleError,
  InvalidSaleQuantityError,
  InvalidSaleStatusTransitionError,
} from './domain/errors/sale-errors.js';

// Repository + reader ports (implemented by infrastructure)
export type {
  ISaleRepository,
  SaleFilters,
  SaleQuery,
  SaleSort,
  SaleSortField,
} from './domain/repositories/sale-repository.js';
export type {
  ISaleUnitOfWork,
  SaleTransactionContext,
} from './domain/repositories/sale-unit-of-work.js';
export type {
  ISaleProductReader,
  ProductPricing,
} from './domain/ports/sale-product-reader.js';
export type { ISaleCustomerReader } from './domain/ports/sale-customer-reader.js';

// Infrastructure implementations
export {
  PrismaSaleRepository,
  type SalePrismaClient,
  type SaleModelDelegate,
  type SaleRow,
  type SaleRowWithDetails,
  type SaleDetailRow,
  type DecimalLike,
} from './infrastructure/prisma-sale-repository.js';
export {
  PrismaSaleUnitOfWork,
  type TransactionalPrismaClient,
  type SaleTransactionClient,
} from './infrastructure/prisma-sale-unit-of-work.js';
export {
  PrismaSaleProductReader,
  type SaleProductReaderPrismaClient,
  type ProductPricingDelegate,
  type ProductPricingRow,
} from './infrastructure/prisma-sale-product-reader.js';
export {
  PrismaSaleCustomerReader,
  type SaleCustomerReaderPrismaClient,
  type CustomerExistsDelegate,
} from './infrastructure/prisma-sale-customer-reader.js';
