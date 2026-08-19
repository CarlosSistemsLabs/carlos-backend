/**
 * Public façade for the Cash module.
 *
 * Other modules and the composition root MUST consume cash capabilities through
 * this barrel rather than reaching into internals (module boundaries, Façade
 * pattern). It exposes the domain layer (entities, value objects, errors,
 * repository/unit-of-work ports), the open/close application use cases + DTOs,
 * and the concrete Prisma repositories/unit-of-work.
 *
 * ## Modelling decisions (task 23.1)
 * - **Open/close lifecycle without a status column.** The `Cash` table has no
 *   open/closed flag, so the register lifecycle is modelled through
 *   {@link CashMovement} *categories*: opening books an `INCOME`/`opening`
 *   movement; closing books a `closing` reconciliation (`INCOME` overage /
 *   `EXPENSE` shortage). The `CashMovement.type` enum stays the schema's
 *   `INCOME | EXPENSE`; `opening`/`closing` live in the free-text `category`
 *   (a superset of the schema's `sale | purchase | other`).
 * - **Overdraft policy.** A register mirrors physical cash and cannot go
 *   negative: an `EXPENSE` exceeding the current balance is rejected
 *   ({@link InsufficientCashBalanceError}); `INCOME` always succeeds.
 * - **Payment link rule.** A {@link Payment} references **exactly one** of a
 *   sale or a purchase — never both, never neither
 *   ({@link InvalidPaymentLinkError}).
 *
 * ## Payment processing (task 23.2)
 * - **Overpayment policy.** A payment settles at most the *outstanding* balance
 *   (`total - alreadyPaid`); tendering more is rejected
 *   ({@link PaymentOverpaymentError}), so a document's payments never exceed its
 *   billed total.
 * - **Cash-register linkage.** Only a `cash` payment with a `cashId` moves the
 *   till — a sale payment books an INCOME/`sale` movement, a purchase payment an
 *   EXPENSE/`purchase` movement, atomically with the payment
 *   ({@link ICashUnitOfWork}). `card`/`transfer`/`check` payments never touch the
 *   register.
 * - **Payment status is derived, never stored.** `unpaid`/`partial`/`paid` is a
 *   pure function of `total` vs the sum of payments ({@link derivePaymentStatus}).
 * - **Reader ports.** Cash reads the sale/purchase `total` through
 *   {@link IPaymentSaleReader}/{@link IPaymentPurchaseReader} implemented in
 *   infrastructure, so it never imports the Sales/Purchases module internals.
 *
 * Not wired here: the HTTP endpoints (task 23.3).
 */

// Presentation (HTTP routes, task 23.3)
export {
  registerCashRoutes,
  buildCashUseCases,
  cashRoutesPlugin,
  type CashRoutesOptions,
} from './presentation/cash.routes.js';
export {
  registerPaymentRoutes,
  buildPaymentUseCases,
  paymentRoutesPlugin,
  type PaymentRoutesOptions,
} from './presentation/payment.routes.js';

// Use cases (application entry points)
export { OpenCashRegisterUseCase } from './application/use-cases/open-cash-register.use-case.js';
export { CloseCashRegisterUseCase } from './application/use-cases/close-cash-register.use-case.js';
export { RecordCashMovementUseCase } from './application/use-cases/record-cash-movement.use-case.js';
export { ListCashMovementsUseCase } from './application/use-cases/list-cash-movements.use-case.js';
export { RecordPaymentUseCase } from './application/use-cases/record-payment.use-case.js';
export { GetPaymentStatusUseCase } from './application/use-cases/get-payment-status.use-case.js';
export { ListPaymentsUseCase } from './application/use-cases/list-payments.use-case.js';

// DTOs + mappers
export {
  DEFAULT_CASH_CURRENCY,
  toCashOutput,
  toCashMovementOutput,
  toPagedCashMovementOutput,
  toCloseCashRegisterOutput,
  type OpenCashRegisterInputDto,
  type CloseCashRegisterInputDto,
  type RecordCashMovementInputDto,
  type ListCashMovementsInputDto,
  type CashOutput,
  type CashMovementOutput,
  type CloseCashRegisterOutput,
} from './application/dto/cash-dtos.js';
export {
  normalizePagination,
  toPaymentOutput,
  toPagedPaymentOutput,
  toPaymentStatusOutput,
  type RecordPaymentInputDto,
  type GetPaymentStatusInputDto,
  type ListPaymentsInputDto,
  type PaymentOutput,
  type PaymentStatusOutput,
  type PagedResult,
  type PageMeta,
  type NormalizedPagination,
} from './application/dto/payment-dtos.js';

// Domain entities
export {
  Cash,
  type CashProps,
  type CreateCashInput,
  type CashReconciliation,
} from './domain/entities/cash.js';
export {
  CashMovement,
  type CashMovementProps,
  type CreateCashMovementInput,
} from './domain/entities/cash-movement.js';
export { Payment, type PaymentProps, type CreatePaymentInput } from './domain/entities/payment.js';

// Value objects
export {
  CASH_MOVEMENT_TYPES,
  isCashMovementType,
  assertCashMovementType,
  cashMovementDelta,
  type CashMovementType,
  type CashMovementDelta,
} from './domain/value-objects/cash-movement-type.js';
export {
  CASH_MOVEMENT_CATEGORIES,
  isCashMovementCategory,
  assertCashMovementCategory,
  type CashMovementCategory,
} from './domain/value-objects/cash-movement-category.js';
export {
  PAYMENT_METHODS,
  isPaymentMethod,
  assertPaymentMethod,
  type PaymentMethod,
} from './domain/value-objects/payment-method.js';
export {
  PAYMENT_STATUSES,
  derivePaymentStatus,
  type PaymentStatus,
} from './domain/value-objects/payment-status.js';

// Errors
export {
  NonPositiveAmountError,
  InsufficientCashBalanceError,
  CashMovementMismatchError,
  InvalidPaymentLinkError,
  PaymentOverpaymentError,
} from './domain/errors/cash-errors.js';

// Repository + unit-of-work ports (implemented by infrastructure)
export type {
  ICashRepository,
  CashFilters,
  CashQuery,
} from './domain/repositories/cash-repository.js';
export type {
  ICashMovementRepository,
  CashMovementFilters,
  CashMovementQuery,
} from './domain/repositories/cash-movement-repository.js';
export type {
  IPaymentRepository,
  PaymentFilters,
  PaymentQuery,
} from './domain/repositories/payment-repository.js';
export type {
  ICashUnitOfWork,
  CashTransactionContext,
} from './domain/repositories/cash-unit-of-work.js';

// Reader ports (implemented by infrastructure against Sale/Purchase tables)
export type {
  IPaymentSaleReader,
  PaymentSaleTotal,
} from './domain/ports/payment-sale-reader.js';
export type {
  IPaymentPurchaseReader,
  PaymentPurchaseTotal,
} from './domain/ports/payment-purchase-reader.js';

// Infrastructure implementations
export {
  PrismaCashRepository,
  type CashPrismaClient,
  type CashModelDelegate,
  type CashRow,
  type DecimalLike,
} from './infrastructure/prisma-cash-repository.js';
export {
  PrismaCashMovementRepository,
  type CashMovementPrismaClient,
  type CashMovementModelDelegate,
  type CashMovementRow,
} from './infrastructure/prisma-cash-movement-repository.js';
export {
  PrismaPaymentRepository,
  type PaymentPrismaClient,
  type PaymentModelDelegate,
  type PaymentRow,
  type PaymentAggregateResult,
} from './infrastructure/prisma-payment-repository.js';
export {
  PrismaPaymentSaleReader,
  type PaymentSaleReaderPrismaClient,
  type SaleTotalDelegate,
  type SaleTotalRow,
} from './infrastructure/prisma-payment-sale-reader.js';
export {
  PrismaPaymentPurchaseReader,
  type PaymentPurchaseReaderPrismaClient,
  type PurchaseTotalDelegate,
  type PurchaseTotalRow,
} from './infrastructure/prisma-payment-purchase-reader.js';
export {
  PrismaCashUnitOfWork,
  type TransactionalPrismaClient,
  type CashTransactionClient,
} from './infrastructure/prisma-cash-unit-of-work.js';
