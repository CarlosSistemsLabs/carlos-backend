import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { CUSTOMER_TOKENS } from '@infrastructure/di/index.js';
import { FEATURES } from '@modules/subscriptions/index.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '@presentation/validators/index.js';
import type { CreateCustomerUseCase } from '../application/use-cases/create-customer.use-case.js';
import type { UpdateCustomerUseCase } from '../application/use-cases/update-customer.use-case.js';
import type { DeleteCustomerUseCase } from '../application/use-cases/delete-customer.use-case.js';
import type { GetCustomerUseCase } from '../application/use-cases/get-customer.use-case.js';
import type { ListCustomersUseCase } from '../application/use-cases/list-customers.use-case.js';
import type { SearchCustomersUseCase } from '../application/use-cases/search-customers.use-case.js';
import type {
  CreateCustomerInputDto,
  ListCustomersInputDto,
  SearchCustomersInputDto,
  UpdateCustomerInputDto,
} from '../application/dto/customer-dtos.js';
import {
  createCustomerBodySchema,
  updateCustomerBodySchema,
  listCustomersQuerySchema,
  searchCustomersQuerySchema,
  customerIdParamSchema,
  createCustomerRouteSchema,
  listCustomersRouteSchema,
  searchCustomersRouteSchema,
  getCustomerRouteSchema,
  updateCustomerRouteSchema,
  deleteCustomerRouteSchema,
} from './customer.schemas.js';

/**
 * The feature key gating the Customers module.
 *
 * Customers is a first-class gated feature: the canonical plan → feature matrix
 * (`PLAN_FEATURE_MATRIX`) grants `customers` from the Starter tier upward, so
 * every tenant with an active subscription can reach these endpoints while a
 * tenant with no active/expired subscription is refused with a 403 by the
 * subscription/feature guard (Requirements 10.4, 12.3, 12.4).
 */
const CUSTOMERS_FEATURE = FEATURES.CUSTOMERS;

/** Bundle of the customer use cases wired from the DI container. */
interface CustomerUseCases {
  create: CreateCustomerUseCase;
  update: UpdateCustomerUseCase;
  remove: DeleteCustomerUseCase;
  get: GetCustomerUseCase;
  list: ListCustomersUseCase;
  search: SearchCustomersUseCase;
}

/** Resolves the customer use cases from the composition container. */
export function buildCustomerUseCases(container: Container): CustomerUseCases {
  return {
    create: container.resolve(CUSTOMER_TOKENS.CreateCustomerUseCase),
    update: container.resolve(CUSTOMER_TOKENS.UpdateCustomerUseCase),
    remove: container.resolve(CUSTOMER_TOKENS.DeleteCustomerUseCase),
    get: container.resolve(CUSTOMER_TOKENS.GetCustomerUseCase),
    list: container.resolve(CUSTOMER_TOKENS.ListCustomersUseCase),
    search: container.resolve(CUSTOMER_TOKENS.SearchCustomersUseCase),
  };
}

/**
 * Returns the authenticated tenant id from the request.
 *
 * Defence in depth: every customer route attaches `app.authenticate`, which
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

/** Options accepted by the {@link customerRoutesPlugin}. */
export interface CustomerRoutesOptions {
  /** Composition container with the customer infrastructure registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the customer endpoints under `/api/v1/customers`.
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
 * parametric `/:id` route so "search" is never captured as a customer id.
 */
export const customerRoutesPlugin: FastifyPluginAsync<CustomerRoutesOptions> = (app, opts) => {
  const useCases = buildCustomerUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // POST /api/v1/customers — create
  app.post(
    '/',
    {
      schema: createCustomerRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CUSTOMERS_FEATURE),
        app.authorize('customers', 'list', 'write'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const body = validateBody(request, createCustomerBodySchema);
      const input: CreateCustomerInputDto = {
        tenantId,
        name: body.name,
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.taxId !== undefined ? { taxId: body.taxId } : {}),
        ...(body.address !== undefined ? { address: body.address } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      };
      const customer = await useCases.create.execute(input);
      return reply.status(201).send(customer);
    },
  );

  // GET /api/v1/customers — list
  app.get(
    '/',
    {
      schema: listCustomersRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CUSTOMERS_FEATURE),
        app.authorize('customers', 'list', 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, listCustomersQuerySchema);
      const input: ListCustomersInputDto = {
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

  // GET /api/v1/customers/search — search (registered BEFORE /:id)
  app.get(
    '/search',
    {
      schema: searchCustomersRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CUSTOMERS_FEATURE),
        app.authorize('customers', 'list', 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, searchCustomersQuerySchema);
      const input: SearchCustomersInputDto = {
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

  // GET /api/v1/customers/:id — details
  app.get(
    '/:id',
    {
      schema: getCustomerRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CUSTOMERS_FEATURE),
        app.authorize('customers', 'detail', 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, customerIdParamSchema);
      const customer = await useCases.get.execute({ id, tenantId });
      return reply.status(200).send(customer);
    },
  );

  // PUT /api/v1/customers/:id — update
  app.put(
    '/:id',
    {
      schema: updateCustomerRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CUSTOMERS_FEATURE),
        app.authorize('customers', 'detail', 'write'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, customerIdParamSchema);
      const body = validateBody(request, updateCustomerBodySchema);
      const input: UpdateCustomerInputDto = {
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
      const customer = await useCases.update.execute(input);
      return reply.status(200).send(customer);
    },
  );

  // DELETE /api/v1/customers/:id — soft delete
  app.delete(
    '/:id',
    {
      schema: deleteCustomerRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CUSTOMERS_FEATURE),
        app.authorize('customers', 'detail', 'delete'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, customerIdParamSchema);
      await useCases.remove.execute({ id, tenantId });
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};

/**
 * Registers the customer routes under the `/api/v1/customers` prefix.
 *
 * Wraps {@link customerRoutesPlugin} in its own encapsulated context so the
 * relaxed validator compiler does not leak to other routes.
 */
export async function registerCustomerRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(customerRoutesPlugin, { prefix: '/api/v1/customers', container });
}
