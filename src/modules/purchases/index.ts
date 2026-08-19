/**
 * Public façade for the Purchases module.
 *
 * Other modules and the composition root MUST consume purchases capabilities
 * through this barrel rather than reaching into internals (module boundaries,
 * Façade pattern). It exposes the domain layer (entities, value objects, errors,
 * repository ports and reader ports), the application use case + DTOs and the
 * concrete Prisma repository/unit-of-work/readers.
 *
 * Not yet wired here: publishing the buffered `PurchaseCompleted` event to drive
 * the stock increment (task 21.2) and the HTTP endpoints (task 21.3).
 */

// Presentation (HTTP routes, task 21.3)
export {
  registerPurchaseRoutes,
  buildPurchaseUseCases,
  purchaseRoutesPlugin,
  type PurchaseRoutesOptions,
} from './presentation/purchase.routes.js';

// Use cases (application entry points)
export { CreatePurchaseUseCase } from './application/use-cases/create-purchase.use-case.js';
export { GetPurchaseUseCase } from './application/use-cases/get-purchase.use-case.js';
export { ListPurchasesUseCase } from './application/use-cases/list-purchases.use-case.js';
export { UpdatePurchaseStatusUseCase } from './application/use-cases/update-purchase-status.use-case.js';
export { DeletePurchaseUseCase } from './application/use-cases/delete-purchase.use-case.js';

// DTOs + mappers
export {
  DEFAULT_PURCHASE_CURRENCY,
  normalizePagination,
  toPurchaseOutput,
  toPurchaseLineOutput,
  toPagedPurchaseOutput,
  type CreatePurchaseInputDto,
  type CreatePurchaseLineInputDto,
  type GetPurchaseInputDto,
  type ListPurchasesInputDto,
  type UpdatePurchaseStatusInputDto,
  type DeletePurchaseInputDto,
  type PurchaseOutput,
  type PurchaseLineOutput,
  type PageMeta,
  type PagedResult,
  type NormalizedPagination,
} from './application/dto/purchase-dtos.js';

// Domain entities
export {
  Purchase,
  type PurchaseProps,
  type CreatePurchaseInput,
  type PurchaseTotals,
} from './domain/entities/purchase.js';
export {
  PurchaseDetail,
  MIN_LINE_TAX_RATE,
  MAX_LINE_TAX_RATE,
  type PurchaseDetailProps,
  type CreatePurchaseDetailInput,
} from './domain/entities/purchase-detail.js';

// Value objects
export {
  PURCHASE_STATUSES,
  DEFAULT_PURCHASE_STATUS,
  isPurchaseStatus,
  assertPurchaseStatus,
  canTransition,
  assertTransition,
  type PurchaseStatus,
} from './domain/value-objects/purchase-status.js';

// Errors
export {
  EmptyPurchaseError,
  InvalidPurchaseQuantityError,
  MissingProductCostError,
  InvalidPurchaseStatusTransitionError,
} from './domain/errors/purchase-errors.js';

// Repository + reader ports (implemented by infrastructure)
export type {
  IPurchaseRepository,
  PurchaseFilters,
  PurchaseQuery,
  PurchaseSort,
  PurchaseSortField,
} from './domain/repositories/purchase-repository.js';
export type {
  IPurchaseUnitOfWork,
  PurchaseTransactionContext,
} from './domain/repositories/purchase-unit-of-work.js';
export type {
  IPurchaseProductReader,
  ProductCost,
} from './domain/ports/purchase-product-reader.js';
export type { IPurchaseSupplierReader } from './domain/ports/purchase-supplier-reader.js';

// Infrastructure implementations
export {
  PrismaPurchaseRepository,
  type PurchasePrismaClient,
  type PurchaseModelDelegate,
  type PurchaseRow,
  type PurchaseRowWithDetails,
  type PurchaseDetailRow,
  type DecimalLike,
} from './infrastructure/prisma-purchase-repository.js';
export {
  PrismaPurchaseUnitOfWork,
  type TransactionalPrismaClient,
  type PurchaseTransactionClient,
} from './infrastructure/prisma-purchase-unit-of-work.js';
export {
  PrismaPurchaseProductReader,
  type PurchaseProductReaderPrismaClient,
  type ProductCostDelegate,
  type ProductCostRow,
} from './infrastructure/prisma-purchase-product-reader.js';
export {
  PrismaPurchaseSupplierReader,
  type PurchaseSupplierReaderPrismaClient,
  type SupplierExistsDelegate,
} from './infrastructure/prisma-purchase-supplier-reader.js';
