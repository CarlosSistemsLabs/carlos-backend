/**
 * Public façade for the Suppliers module.
 *
 * Other modules and the composition root MUST consume supplier capabilities
 * through this barrel rather than reaching into internals (module boundaries,
 * Façade pattern). It exposes the domain layer (entity, value objects and
 * repository port), the application use cases + DTOs, the concrete Prisma
 * repository and the HTTP routes (task 17.3).
 *
 * Suppliers mirror the Customers module structure: an identical Prisma shape and
 * the same CRUD + search surface, but on the purchase side of the platform. The
 * Email/Phone/TaxId value objects are duplicated module-locally (not imported
 * from Customers) to keep the bounded-context boundary clean — the established
 * pattern for these small VOs.
 */

// Presentation (HTTP routes)
export {
  registerSupplierRoutes,
  buildSupplierUseCases,
  supplierRoutesPlugin,
  type SupplierRoutesOptions,
} from './presentation/supplier.routes.js';

// Use cases (application entry points)
export { CreateSupplierUseCase } from './application/use-cases/create-supplier.use-case.js';
export { UpdateSupplierUseCase } from './application/use-cases/update-supplier.use-case.js';
export { DeleteSupplierUseCase } from './application/use-cases/delete-supplier.use-case.js';
export { GetSupplierUseCase } from './application/use-cases/get-supplier.use-case.js';
export { ListSuppliersUseCase } from './application/use-cases/list-suppliers.use-case.js';
export { SearchSuppliersUseCase } from './application/use-cases/search-suppliers.use-case.js';

// DTOs + mappers
export {
  normalizePagination,
  toSupplierOutput,
  toPagedSupplierOutput,
  type CreateSupplierInputDto,
  type UpdateSupplierInputDto,
  type DeleteSupplierInputDto,
  type GetSupplierInputDto,
  type ListSuppliersInputDto,
  type SearchSuppliersInputDto,
  type SupplierOutput,
  type PageMeta,
  type PagedResult,
  type NormalizedPagination,
} from './application/dto/supplier-dtos.js';

// Domain entity
export {
  Supplier,
  type SupplierProps,
  type CreateSupplierInput,
  type UpdateContactInput,
} from './domain/entities/supplier.js';

// Value objects
export { Email, EMAIL_MAX_LENGTH } from './domain/value-objects/email.js';
export { Phone, PHONE_MIN_DIGITS, PHONE_MAX_DIGITS } from './domain/value-objects/phone.js';
export { TaxId, TAX_ID_MIN_LENGTH, TAX_ID_MAX_LENGTH } from './domain/value-objects/tax-id.js';

// Repository port (implemented by infrastructure)
export type {
  ISupplierRepository,
  SupplierFilters,
  SupplierQuery,
  SupplierSort,
  SupplierSortField,
} from './domain/repositories/supplier-repository.js';

// Infrastructure implementation
export {
  PrismaSupplierRepository,
  type SupplierPrismaClient,
  type SupplierModelDelegate,
  type SupplierRow,
} from './infrastructure/prisma-supplier-repository.js';
