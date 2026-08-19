/**
 * Public façade for the Stock module.
 *
 * Other modules and the composition root MUST consume stock capabilities
 * through this barrel rather than reaching into internals (module boundaries,
 * Façade pattern). It exposes the domain layer (entities, value objects, errors
 * and repository ports), the application use cases + DTOs (task 15.1) and the
 * concrete Prisma repositories + unit of work.
 *
 * Not yet wired here: automatic sale/purchase stock decrement (task 15.2) and
 * the HTTP endpoints (task 15.3). `AdjustStockUseCase` is the single inventory
 * write path, so 15.2's event handlers can drive it directly.
 */

// Use cases (application entry points)
export { AdjustStockUseCase } from './application/use-cases/adjust-stock.use-case.js';
export { GetStockLevelsUseCase } from './application/use-cases/get-stock-levels.use-case.js';
export { RecordStockMovementUseCase } from './application/use-cases/record-stock-movement.use-case.js';
export { GetStockMovementHistoryUseCase } from './application/use-cases/get-stock-movement-history.use-case.js';
export { ListStockMovementsByCursorUseCase } from './application/use-cases/list-stock-movements-by-cursor.use-case.js';

// Event handlers (consumer side of inter-module communication, task 15.2)
export {
  StockEventHandlers,
  type StockEventLogger,
} from './application/event-handlers/stock-event-handlers.js';

// DTOs + mappers
export {
  normalizePagination,
  toStockOutput,
  toStockMovementOutput,
  toStockLevelOutput,
  toPagedStockLevelOutput,
  toPagedStockMovementOutput,
  toCursorPagedStockMovementOutput,
  type AdjustStockInputDto,
  type RecordStockMovementInputDto,
  type GetStockMovementHistoryInputDto,
  type ListStockMovementsByCursorInputDto,
  type GetStockLevelsInputDto,
  type StockOutput,
  type StockMovementOutput,
  type AdjustStockOutput,
  type StockLevelOutput,
  type PageMeta,
  type PagedResult,
  type CursorPagedResult,
  type NormalizedPagination,
} from './application/dto/stock-dtos.js';

// Domain entities
export {
  Stock,
  type StockProps,
  type CreateStockInput,
} from './domain/entities/stock.js';
export {
  StockMovement,
  type StockMovementProps,
  type CreateStockMovementInput,
} from './domain/entities/stock-movement.js';

// Value objects
export {
  STOCK_MOVEMENT_TYPES,
  isStockMovementType,
  assertStockMovementType,
  stockMovementDelta,
  type StockMovementType,
  type StockMovementDelta,
} from './domain/value-objects/stock-movement-type.js';

// Errors
export {
  InsufficientStockError,
  InvalidStockTransferError,
} from './domain/errors/stock-errors.js';

// Repository ports (implemented by infrastructure)
export type {
  IStockRepository,
  StockLevelView,
  StockLevelFilters,
  StockLevelQuery,
} from './domain/repositories/stock-repository.js';
export type {
  IStockMovementRepository,
  StockMovementFilters,
  StockMovementQuery,
} from './domain/repositories/stock-movement-repository.js';
export type {
  IStockMovementCursorReader,
  StockMovementCursorQuery,
} from './domain/repositories/stock-movement-cursor-reader.js';
export type {
  IStockUnitOfWork,
  StockTransactionContext,
} from './domain/repositories/stock-unit-of-work.js';

// Infrastructure implementations
export {
  PrismaStockRepository,
  type StockPrismaClient,
  type StockModelDelegate,
  type StockRow,
  type StockRowWithProduct,
  type LowStockRow,
} from './infrastructure/prisma-stock-repository.js';
export {
  PrismaStockMovementRepository,
  type StockMovementPrismaClient,
  type StockMovementModelDelegate,
  type StockMovementRow,
} from './infrastructure/prisma-stock-movement-repository.js';
export {
  PrismaStockUnitOfWork,
  type TransactionalPrismaClient,
  type StockTransactionClient,
} from './infrastructure/prisma-stock-unit-of-work.js';
