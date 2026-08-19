import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { SUPPLIER_TOKENS } from '@infrastructure/di/index.js';
import { FEATURES } from '@modules/subscriptions/index.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '@presentation/validators/index.js';
import type { CreateSupplierUseCase } from '../application/use-cases/create-supplier.use-case.js';
import type { UpdateSupplierUseCase } from '../application/use-cases/update-supplier.use-case.js';
import type { DeleteSupplierUseCase } from '../application/use-cases/delete-supplier.use-case.js';
import type { GetSupplierUseCase } from '../application/use-cases/get-supplier.use-case.js';
import type { ListSuppliersUseCase } from '../application/use-cases/list-suppliers.use-case.js';
import type { SearchSuppliersUseCase } from '../application/use-cases/search-suppliers.use-case.js';
import type {
  CreateSupplierInputDto,
  ListSuppliersInputDto,
  SearchSuppliersInputDto,
  UpdateSupplierInputDto,
} from '../application/dto/supplier-dtos.js';
import {
  createSupplierBodySchema,
  updateSupplierBodySchema,
  listSuppliersQuerySchema,
  searchSuppliersQuerySchema,
  supplierIdParamSchema,
  createSupplierRouteSchema,
  listSuppliersRouteSchema,
  searchSuppliersRouteSchema,
  getSupplierRouteSchema,
  updateSupplierRouteSchema,
  deleteSupplierRouteSchema,
} from './supplier.schemas.js';

/**
 * The feature key gating the Suppliers module.
 *
 * **Feature-key reconciliation (Requirement 10.3):** the canonical plan →
 * feature matrix (`PLAN_FEATURE_MATRIX`) does NOT contain a `suppliers`
 * feature — it lists `sales`, `customers`, `stock`, `cash`, `reports`,
 * `purchases`, `api`, `branches`, `dashboard` and `integrations`. Suppliers are
 * the purchase-side master data: you cannot record a purchase without a
 * supplier, and `purchases` is the Enterprise-tier feature that owns that flow.
 * Gating suppliers behind {@link FEATURES.PURCHASES} therefore keeps supplier
 * management available to exactly the tenants whose plan grants purchasing while
 * still enforcing the subscription/feature guard (no active/expired subscription
 * or a plan without `purchases` → 403). This mirrors the products→sales
 * reconciliation: a foundational resource is gated behind the higher-level
 * feature that depends on it, rather than leaving the routes ungated.
 */
const SUPPLIERS_FEATURE = FEATURES.PURCHASES;

/** Bundle of the supplier use cases wired from the DI container. */
interface SupplierUseCases {
  create: CreateSupplierUseCase;
  update: UpdateSupplierUseCase;
  remove: DeleteSupplierUseCase;
  get: GetSupplierUseCase;
  list: ListSuppliersUseCase;
  search: SearchSuppliersUseCase;
}

/** Resolves the supplier use cases from the composition container. */
export function buildSupplierUseCases(container: Container): SupplierUseCases {
  return {
    create: container.resolve(SUPPLIER_TOKENS.CreateSupplierUseCase),
    update: container.resolve(SUPPLIER_TOKENS.UpdateSupplierUseCase),
    remove: container.resolve(SUPPLIER_TOKENS.DeleteSupplierUseCase),
    get: container.resolve(SUPPLIER_TOKENS.GetSupplierUseCase),
    list: container.resolve(SUPPLIER_TOKENS.ListSuppliersUseCase),
    search: container.resolve(SUPPLIER_TOKENS.SearchSuppliersUseCase),
  };
}

/**
 * Returns the authenticated tenant id from the request.
 *
 * Defence in depth: every supplier route attaches `app.authenticate`, which
 * populates `request.auth`; should that be bypassed the handler still refuses
 * with a 401 rather than operating without a tenant scope (Requirement 1.5).
 */
function requireTenantId(request: FastifyRequest): string {
  const auth = request.auth;
  if (auth === undefined) {
    throw new UnauthorizedError('Authentication required');
  }
  return auth.tenantId;
}

/** Options accepted by the {@link supplierRoutesPlugin}. */
export interface SupplierRoutesOptions {
  /** Composition container with the supplier infrastructure registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the supplier endpoints under `/api/v1/suppliers`.
 *
 * Every route is protected: `app.authenticate` verifies the bearer token
 * (401 on failure), `app.requireFeature` enforces the subscription/feature
 * guard (403 when the tenant's plan does not grant the feature) and
 * `app.authorize(module, screen, action)` enforces RBAC (403 when the role
 * lacks the permission). Inputs are validated with Zod via the shared
 * validators; validation failures map to the consistent 400 envelope through
 * the central error handler (Requirements 25.5–25.7). The attached `schema`
 * objects document the routes for OpenAPI (Requirement 3.7); Fastify's own
 * validation is disabled inside this encapsulated plugin so it never
 * short-circuits the Zod checks.
 *
 * Route ordering: the static `/search` route is registered BEFORE the
 * parametric `/:id` route so "search" is never captured as a supplier id.
 */
export const supplierRoutesPlugin: FastifyPluginAsync<SupplierRoutesOptions> = (app, opts) => {
  const useCases = buildSupplierUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // POST /api/v1/suppliers — create
  app.post(
    '/',
    {
      schema: createSupplierRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(SUPPLIERS_FEATURE),
        app.authorize('suppliers', 'list', 'write'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const body = validateBody(request, createSupplierBodySchema);
      const input: CreateSupplierInputDto = {
        tenantId,
        name: body.name,
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.taxId !== undefined ? { taxId: body.taxId } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      };
      const supplier = await useCases.create.execute(input);
      return reply.status(201).send(supplier);
    },
  );

  // GET /api/v1/suppliers — list
  app.get(
    '/',
    {
      schema: listSuppliersRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(SUPPLIERS_FEATURE),
        app.authorize('suppliers', 'list', 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, listSuppliersQuerySchema);
      const input: ListSuppliersInputDto = {
        tenantId,
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
        ...(query.sort !== undefined
          ? { sortBy: query.sort.sortBy, sortDirection: query.sort.sortDirection }
          : {}),
      };
      const result = await useCases.list.execute(input);
      return reply.status(200).send(result);
    },
  );

  // GET /api/v1/suppliers/search — search (registered BEFORE /:id)
  app.get(
    '/search',
    {
      schema: searchSuppliersRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(SUPPLIERS_FEATURE),
        app.authorize('suppliers', 'list', 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, searchSuppliersQuerySchema);
      const input: SearchSuppliersInputDto = {
        tenantId,
        term: query.q,
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      };
      const result = await useCases.search.execute(input);
      return reply.status(200).send(result);
    },
  );

  // GET /api/v1/suppliers/:id — details
  app.get(
    '/:id',
    {
      schema: getSupplierRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(SUPPLIERS_FEATURE),
        app.authorize('suppliers', 'detail', 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, supplierIdParamSchema);
      const supplier = await useCases.get.execute({ id, tenantId });
      return reply.status(200).send(supplier);
    },
  );

  // PUT /api/v1/suppliers/:id — update
  app.put(
    '/:id',
    {
      schema: updateSupplierRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(SUPPLIERS_FEATURE),
        app.authorize('suppliers', 'detail', 'write'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, supplierIdParamSchema);
      const body = validateBody(request, updateSupplierBodySchema);
      const input: UpdateSupplierInputDto = {
        id,
        tenantId,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.taxId !== undefined ? { taxId: body.taxId } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      };
      const supplier = await useCases.update.execute(input);
      return reply.status(200).send(supplier);
    },
  );

  // DELETE /api/v1/suppliers/:id — soft delete
  app.delete(
    '/:id',
    {
      schema: deleteSupplierRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(SUPPLIERS_FEATURE),
        app.authorize('suppliers', 'detail', 'delete'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, supplierIdParamSchema);
      await useCases.remove.execute({ id, tenantId });
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};

/**
 * Registers the supplier routes under the `/api/v1/suppliers` prefix.
 *
 * Wraps {@link supplierRoutesPlugin} in its own encapsulated context so the
 * relaxed validator compiler does not leak to other routes.
 */
export async function registerSupplierRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(supplierRoutesPlugin, { prefix: '/api/v1/suppliers', container });
}
