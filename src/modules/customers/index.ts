/**
 * Public façade for the Customers module.
 *
 * Other modules and the composition root MUST consume customer capabilities
 * through this barrel rather than reaching into internals (module boundaries,
 * Façade pattern). It exposes the domain layer (entity, value objects and
 * repository port), the application use cases + DTOs (task 17.1) and the
 * concrete Prisma repository. HTTP endpoints (task 17.2) are re-exported here
 * once added.
 */

// Presentation (HTTP routes, task 17.2)
export {
  registerCustomerRoutes,
  buildCustomerUseCases,
  customerRoutesPlugin,
  type CustomerRoutesOptions,
} from './presentation/customer.routes.js';

// Use cases (application entry points)
export { CreateCustomerUseCase } from './application/use-cases/create-customer.use-case.js';
export { UpdateCustomerUseCase } from './application/use-cases/update-customer.use-case.js';
export { DeleteCustomerUseCase } from './application/use-cases/delete-customer.use-case.js';
export { GetCustomerUseCase } from './application/use-cases/get-customer.use-case.js';
export { ListCustomersUseCase } from './application/use-cases/list-customers.use-case.js';
export { SearchCustomersUseCase } from './application/use-cases/search-customers.use-case.js';

// DTOs + mappers
export {
  normalizePagination,
  toCustomerOutput,
  toPagedCustomerOutput,
  type CreateCustomerInputDto,
  type UpdateCustomerInputDto,
  type DeleteCustomerInputDto,
  type GetCustomerInputDto,
  type ListCustomersInputDto,
  type SearchCustomersInputDto,
  type CustomerOutput,
  type PageMeta,
  type PagedResult,
  type NormalizedPagination,
} from './application/dto/customer-dtos.js';

// Domain entity
export {
  Customer,
  type CustomerProps,
  type CreateCustomerInput,
  type UpdateContactInput,
} from './domain/entities/customer.js';

// Value objects
export { Email, EMAIL_MAX_LENGTH } from './domain/value-objects/email.js';
export { Phone, PHONE_MIN_DIGITS, PHONE_MAX_DIGITS } from './domain/value-objects/phone.js';
export { TaxId, TAX_ID_MIN_LENGTH, TAX_ID_MAX_LENGTH } from './domain/value-objects/tax-id.js';

// Repository port (implemented by infrastructure)
export type {
  ICustomerRepository,
  CustomerFilters,
  CustomerQuery,
  CustomerSort,
  CustomerSortField,
} from './domain/repositories/customer-repository.js';

// Infrastructure implementation
export {
  PrismaCustomerRepository,
  type CustomerPrismaClient,
  type CustomerModelDelegate,
  type CustomerRow,
} from './infrastructure/prisma-customer-repository.js';
