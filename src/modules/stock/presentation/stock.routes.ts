import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { STOCK_TOKENS } from '@infrastructure/di/index.js';
import { FEATURES } from '@modules/subscriptions/index.js';
import { validateBody, validateQuery } from '@presentation/validators/index.js';
import type { AdjustStockUseCase } from '../application/use-cases/adjust-stock.use-case.js';
import type { GetStockLevelsUseCase } from '../application/use-cases/get-stock-levels.use-case.js';
import type { GetStockMovementHistoryUseCase } from '../application/use-cases/get-stock-movement-history.use-case.js';
import type { ListStockMovementsByCursorUseCase } from '../application/use-cases/list-stock-movements-by-cursor.use-case.js';
import type {
  AdjustStockInputDto,
  GetStockLevelsInputDto,
  GetStockMovementHistoryInputDto,
  ListStockMovementsByCursorInputDto,
} from '../application/dto/stock-dtos.js';
import {
  adjustStockBodySchema,
  listStockAlertsQuerySchema,
  listStockLevelsQuerySchema,
  listStockMovementsQuerySchema,
  listStockMovementsByCursorQuerySchema,
  adjustStockRouteSchema,
  listStockAlertsRouteSchema,
  listStockLevelsRouteSchema,
  listStockMovementsRouteSchema,
  listStockMovementsByCursorRouteSchema,
} from './stock.schemas.js';

/**
 * The feature key gating the Stock module.
 *
 * Stock is a first-class gated feature in the canonical plan → feature matrix
 * (Requirement 10.3): it is granted from the Business tier upward. The guard
 * therefore uses {@link FEATURES.STOCK}, so a tenant whose plan does not include
 * stock (e.g. Starter) — or whose subscription is inactive/expired — receives a
 * 403 from `app.requireFeature` before any handler runs.
 */
const STOCK_FEATURE = FEATURES.STOCK;

/** Bundle of the stock use cases wired from the DI container. */
interface StockUseCases {
  adjust: AdjustStockUseCase;
  levels: GetStockLevelsUseCase;
  movements: GetStockMovementHistoryUseCase;
  movementsCursor: ListStockMovementsByCursorUseCase;
}

/** Resolves the stock use cases from the composition container. */
export function buildStockUseCases(container: Container): StockUseCases {
  return {
    adjust: container.resolve(STOCK_TOKENS.AdjustStockUseCase),
    levels: container.resolve(STOCK_TOKENS.GetStockLevelsUseCase),
    movements: container.resolve(STOCK_TOKENS.GetStockMovementHistoryUseCase),
    movementsCursor: container.resolve(STOCK_TOKENS.ListStockMovementsByCursorUseCase),
  };
}

/**
 * Returns the authenticated tenant id from the request.
 *
 * Defence in depth: every stock route attaches `app.authenticate`, which
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

/** Options accepted by the {@link stockRoutesPlugin}. */
export interface StockRoutesOptions {
  /** Composition container with the stock infrastructure registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the stock-management endpoints under `/api/v1/stock`.
 *
 * Every route is protected by, in order: `app.authenticate` (401 on a bad/absent
 * token), `app.requireFeature(FEATURES.STOCK)` (403 when the plan/subscription
 * does not grant stock) and `app.authorize(module, screen, action)` (403 when
 * the role lacks the permission). Inputs are validated with Zod via the shared
 * validators; validation failures map to the consistent 400 envelope through the
 * central error handler (Requirements 25.5–25.7). An insufficient-stock OUT/
 * TRANSFER surfaces as a 422 (a `BusinessRuleError`). The attached `schema`
 * objects document the routes for OpenAPI (Requirement 3.7); Fastify's own
 * validation is disabled inside this encapsulated plugin so it never
 * short-circuits the Zod checks.
 *
 * Route ordering: the static `/alerts` and `/movements` routes are registered
 * before any parametric route so their paths are never captured as a segment.
 */
export const stockRoutesPlugin: FastifyPluginAsync<StockRoutesOptions> = (app, opts) => {
  const useCases = buildStockUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // GET /api/v1/stock — list stock levels (each with a lowStock flag)
  app.get(
    '/',
    {
      schema: listStockLevelsRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(STOCK_FEATURE),
        app.authorize('stock', 'list', 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, listStockLevelsQuerySchema);
      const input: GetStockLevelsInputDto = {
        tenantId,
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.productId !== undefined ? { productId: query.productId } : {}),
        ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
      };
      const result = await useCases.levels.execute(input);
      return reply.status(200).send(result);
    },
  );

  // GET /api/v1/stock/alerts — low-stock alerts (registered BEFORE any :param)
  app.get(
    '/alerts',
    {
      schema: listStockAlertsRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(STOCK_FEATURE),
        app.authorize('stock', 'list', 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, listStockAlertsQuerySchema);
      const input: GetStockLevelsInputDto = {
        tenantId,
        lowStockOnly: true,
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
      };
      const result = await useCases.levels.execute(input);
      return reply.status(200).send(result);
    },
  );

  // GET /api/v1/stock/movements — movement history
  app.get(
    '/movements',
    {
      schema: listStockMovementsRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(STOCK_FEATURE),
        app.authorize('stock', 'movements', 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, listStockMovementsQuerySchema);
      const input: GetStockMovementHistoryInputDto = {
        tenantId,
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.productId !== undefined ? { productId: query.productId } : {}),
        ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
        ...(query.type !== undefined ? { type: query.type } : {}),
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
      };
      const result = await useCases.movements.execute(input);
      return reply.status(200).send(result);
    },
  );

  // GET /api/v1/stock/movements/cursor — movement history (cursor pagination)
  app.get(
    '/movements/cursor',
    {
      schema: listStockMovementsByCursorRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(STOCK_FEATURE),
        app.authorize('stock', 'movements', 'read'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const query = validateQuery(request, listStockMovementsByCursorQuerySchema);
      const input: ListStockMovementsByCursorInputDto = {
        tenantId,
        ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(query.productId !== undefined ? { productId: query.productId } : {}),
        ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
        ...(query.type !== undefined ? { type: query.type } : {}),
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
      };
      const result = await useCases.movementsCursor.execute(input);
      return reply.status(200).send(result);
    },
  );

  // POST /api/v1/stock/adjust — adjust a stock level and record the movement
  app.post(
    '/adjust',
    {
      schema: adjustStockRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(STOCK_FEATURE),
        app.authorize('stock', 'list', 'write'),
      ],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const body = validateBody(request, adjustStockBodySchema);
      const input: AdjustStockInputDto = {
        tenantId,
        productId: body.productId,
        type: body.type,
        quantity: body.quantity,
        ...(body.branchId !== undefined ? { branchId: body.branchId } : {}),
        ...(body.destinationBranchId !== undefined
          ? { destinationBranchId: body.destinationBranchId }
          : {}),
        ...(body.reference !== undefined ? { reference: body.reference } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      };
      const result = await useCases.adjust.execute(input);
      return reply.status(200).send(result);
    },
  );

  return Promise.resolve();
};

/**
 * Registers the stock routes under the `/api/v1/stock` prefix.
 *
 * Wraps {@link stockRoutesPlugin} in its own encapsulated context so the
 * relaxed validator compiler does not leak to other routes.
 */
export async function registerStockRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(stockRoutesPlugin, { prefix: '/api/v1/stock', container });
}
