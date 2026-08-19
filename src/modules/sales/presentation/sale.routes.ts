import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { SALES_TOKENS } from '@infrastructure/di/index.js';
import { FEATURES } from '@modules/subscriptions/index.js';
import { validateBody, validateParams, validateQuery } from '@presentation/validators/index.js';
import type { CreateSaleUseCase } from '../application/use-cases/create-sale.use-case.js';
import type { GetSaleUseCase } from '../application/use-cases/get-sale.use-case.js';
import type { ListSalesUseCase } from '../application/use-cases/list-sales.use-case.js';
import type { UpdateSaleStatusUseCase } from '../application/use-cases/update-sale-status.use-case.js';
import type { DeleteSaleUseCase } from '../application/use-cases/delete-sale.use-case.js';
import type {
  CreateSaleInputDto,
  ListSalesInputDto,
  UpdateSaleStatusInputDto,
} from '../application/dto/sale-dtos.js';
import {
  createSaleBodySchema,
  updateSaleStatusBodySchema,
  listSalesQuerySchema,
  saleIdParamSchema,
  createSaleRouteSchema,
  listSalesRouteSchema,
  getSaleRouteSchema,
  updateSaleStatusRouteSchema,
  deleteSaleRouteSchema,
} from './sale.schemas.js';

/**
 * The feature key gating the Sales module.
 *
 * Sales is a first-class gated feature: the canonical plan → feature matrix
 * (`PLAN_FEATURE_MATRIX`) grants `sales` from the Starter tier upward, so every
 * tenant with an active subscription can reach these endpoints while a tenant
 * with no active/expired subscription is refused with a 403 by the
 * subscription/feature guard (Requirements 10.3, 10.4, 12.3, 12.4).
 */
const SALES_FEATURE = FEATURES.SALES;

/** Bundle of the sale use cases wired from the DI container. */
interface SaleUseCases {
  create: CreateSaleUseCase;
  get: GetSaleUseCase;
  list: ListSalesUseCase;
  updateStatus: UpdateSaleStatusUseCase;
  remove: DeleteSaleUseCase;
}

/** Resolves the sale use cases from the composition container. */
export function buildSaleUseCases(container: Container): SaleUseCases {
  return {
    create: container.resolve(SALES_TOKENS.CreateSaleUseCase),
    get: container.resolve(SALES_TOKENS.GetSaleUseCase),
    list: container.resolve(SALES_TOKENS.ListSalesUseCase),
    updateStatus: container.resolve(SALES_TOKENS.UpdateSaleStatusUseCase),
    remove: container.resolve(SALES_TOKENS.DeleteSaleUseCase),
  };
}

/** The authenticated identity a sale route needs (tenant scope + author). */
interface SaleActor {
  tenantId: string;
  userId: string;
}

/**
 * Returns the authenticated tenant id + user id from the request.
 *
 * Defence in depth: every sale route attaches `app.authenticate`, which
 * populates `request.auth`; should that be bypassed the handler still refuses
 * with a 401 rather than operating without a tenant scope (Requirement 1.5).
 * The sale's `userId` (author) is taken from the token, never the client body,
 * so authorship cannot be spoofed.
 */
function requireActor(request: FastifyRequest): SaleActor {
  const auth = request.auth;
  if (auth === undefined) {
    throw new UnauthorizedError('Authentication required');
  }
  return { tenantId: auth.tenantId, userId: auth.userId };
}

/** Options accepted by the {@link saleRoutesPlugin}. */
export interface SaleRoutesOptions {
  /** Composition container with the sales infrastructure registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the sale endpoints under `/api/v1/sales`.
 *
 * Every route is protected: `app.authenticate` verifies the bearer token
 * (401 on failure), `app.requireFeature` enforces the subscription/feature
 * guard (403 when the tenant's plan does not grant `sales`) and
 * `app.authorize(module, screen, action)` enforces RBAC (403 when the role
 * lacks the permission). Inputs are validated with Zod via the shared
 * validators; validation failures map to the consistent 400 envelope, while an
 * illegal status transition surfaces as 422 (the domain
 * `InvalidSaleStatusTransitionError` is a `BusinessRuleError`). The attached
 * `schema` objects document the routes for OpenAPI (Requirement 3.7); Fastify's
 * own validation is disabled inside this encapsulated plugin so it never
 * short-circuits the Zod checks.
 */
export const saleRoutesPlugin: FastifyPluginAsync<SaleRoutesOptions> = (app, opts) => {
  const useCases = buildSaleUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // POST /api/v1/sales — create (with transaction)
  app.post(
    '/',
    {
      schema: createSaleRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(SALES_FEATURE),
        app.authorize('sales', 'list', 'write'),
      ],
    },
    async (request, reply) => {
      const { tenantId, userId } = requireActor(request);
      const body = validateBody(request, createSaleBodySchema);
      const input: CreateSaleInputDto = {
        tenantId,
        userId,
        customerId: body.customerId,
        items: body.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        ...(body.branchId !== undefined ? { branchId: body.branchId } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      };
      const sale = await useCases.create.execute(input);
      return reply.status(201).send(sale);
    },
  );

  // GET /api/v1/sales — list (filter by date/customer/status)
  app.get(
    '/',
    {
      schema: listSalesRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(SALES_FEATURE),
        app.authorize('sales', 'list', 'read'),
      ],
    },
    async (request, reply) => {
      const { tenantId } = requireActor(request);
      const query = validateQuery(request, listSalesQuerySchema);
      const input: ListSalesInputDto = {
        tenantId,
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.customerId !== undefined ? { customerId: query.customerId } : {}),
        ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
        ...(query.sort !== undefined
          ? { sortBy: query.sort.sortBy, sortDirection: query.sort.sortDirection }
          : {}),
      };
      const result = await useCases.list.execute(input);
      return reply.status(200).send(result);
    },
  );

  // GET /api/v1/sales/:id — details (with line items)
  app.get(
    '/:id',
    {
      schema: getSaleRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(SALES_FEATURE),
        app.authorize('sales', 'detail', 'read'),
      ],
    },
    async (request, reply) => {
      const { tenantId } = requireActor(request);
      const { id } = validateParams(request, saleIdParamSchema);
      const sale = await useCases.get.execute({ id, tenantId });
      return reply.status(200).send(sale);
    },
  );

  // PUT /api/v1/sales/:id/status — update status (draft, completed, cancelled)
  app.put(
    '/:id/status',
    {
      schema: updateSaleStatusRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(SALES_FEATURE),
        app.authorize('sales', 'detail', 'write'),
      ],
    },
    async (request, reply) => {
      const { tenantId } = requireActor(request);
      const { id } = validateParams(request, saleIdParamSchema);
      const body = validateBody(request, updateSaleStatusBodySchema);
      const input: UpdateSaleStatusInputDto = { id, tenantId, status: body.status };
      const sale = await useCases.updateStatus.execute(input);
      return reply.status(200).send(sale);
    },
  );

  // DELETE /api/v1/sales/:id — soft delete
  app.delete(
    '/:id',
    {
      schema: deleteSaleRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(SALES_FEATURE),
        app.authorize('sales', 'detail', 'delete'),
      ],
    },
    async (request, reply) => {
      const { tenantId } = requireActor(request);
      const { id } = validateParams(request, saleIdParamSchema);
      await useCases.remove.execute({ id, tenantId });
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};

/**
 * Registers the sale routes under the `/api/v1/sales` prefix.
 *
 * Wraps {@link saleRoutesPlugin} in its own encapsulated context so the relaxed
 * validator compiler does not leak to other routes.
 */
export async function registerSaleRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(saleRoutesPlugin, { prefix: '/api/v1/sales', container });
}
