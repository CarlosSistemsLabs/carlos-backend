import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { PURCHASE_TOKENS } from '@infrastructure/di/index.js';
import { FEATURES } from '@modules/subscriptions/index.js';
import { validateBody, validateParams, validateQuery } from '@presentation/validators/index.js';
import type { CreatePurchaseUseCase } from '../application/use-cases/create-purchase.use-case.js';
import type { GetPurchaseUseCase } from '../application/use-cases/get-purchase.use-case.js';
import type { ListPurchasesUseCase } from '../application/use-cases/list-purchases.use-case.js';
import type { UpdatePurchaseStatusUseCase } from '../application/use-cases/update-purchase-status.use-case.js';
import type { DeletePurchaseUseCase } from '../application/use-cases/delete-purchase.use-case.js';
import type {
  CreatePurchaseInputDto,
  CreatePurchaseLineInputDto,
  ListPurchasesInputDto,
  UpdatePurchaseStatusInputDto,
} from '../application/dto/purchase-dtos.js';
import {
  createPurchaseBodySchema,
  updatePurchaseStatusBodySchema,
  listPurchasesQuerySchema,
  purchaseIdParamSchema,
  createPurchaseRouteSchema,
  listPurchasesRouteSchema,
  getPurchaseRouteSchema,
  updatePurchaseStatusRouteSchema,
  deletePurchaseRouteSchema,
} from './purchase.schemas.js';

/**
 * The feature key gating the Purchases module.
 *
 * Purchases is an Enterprise-tier feature: the canonical plan → feature matrix
 * (`PLAN_FEATURE_MATRIX`) grants `purchases` only at the Enterprise tier, so a
 * tenant on Starter/Business (or with no active subscription) is refused with a
 * 403 by the subscription/feature guard (Requirements 10.3, 10.4, 12.3, 12.4).
 */
const PURCHASES_FEATURE = FEATURES.PURCHASES;

/** Bundle of the purchase use cases wired from the DI container. */
interface PurchaseUseCases {
  create: CreatePurchaseUseCase;
  get: GetPurchaseUseCase;
  list: ListPurchasesUseCase;
  updateStatus: UpdatePurchaseStatusUseCase;
  remove: DeletePurchaseUseCase;
}

/** Resolves the purchase use cases from the composition container. */
export function buildPurchaseUseCases(container: Container): PurchaseUseCases {
  return {
    create: container.resolve(PURCHASE_TOKENS.CreatePurchaseUseCase),
    get: container.resolve(PURCHASE_TOKENS.GetPurchaseUseCase),
    list: container.resolve(PURCHASE_TOKENS.ListPurchasesUseCase),
    updateStatus: container.resolve(PURCHASE_TOKENS.UpdatePurchaseStatusUseCase),
    remove: container.resolve(PURCHASE_TOKENS.DeletePurchaseUseCase),
  };
}

/** The authenticated identity a purchase route needs (tenant scope + author). */
interface PurchaseActor {
  tenantId: string;
  userId: string;
}

/**
 * Returns the authenticated tenant id + user id from the request.
 *
 * Defence in depth: every purchase route attaches `app.authenticate`, which
 * populates `request.auth`; should that be bypassed the handler still refuses
 * with a 401 rather than operating without a tenant scope (Requirement 1.5).
 * The purchase's `userId` (author) is taken from the token, never the client
 * body, so authorship cannot be spoofed.
 */
function requireActor(request: FastifyRequest): PurchaseActor {
  const auth = request.auth;
  if (auth === undefined) {
    throw new UnauthorizedError('Authentication required');
  }
  return { tenantId: auth.tenantId, userId: auth.userId };
}

/** Options accepted by the {@link purchaseRoutesPlugin}. */
export interface PurchaseRoutesOptions {
  /** Composition container with the purchases infrastructure registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the purchase endpoints under `/api/v1/purchases`.
 *
 * Every route is protected: `app.authenticate` verifies the bearer token
 * (401 on failure), `app.requireFeature` enforces the subscription/feature
 * guard (403 when the tenant's plan does not grant `purchases`) and
 * `app.authorize(module, screen, action)` enforces RBAC (403 when the role
 * lacks the permission). Inputs are validated with Zod via the shared
 * validators; validation failures map to the consistent 400 envelope, while an
 * illegal status transition surfaces as 422 (the domain
 * `InvalidPurchaseStatusTransitionError` is a `BusinessRuleError`). The attached
 * `schema` objects document the routes for OpenAPI (Requirement 3.7); Fastify's
 * own validation is disabled inside this encapsulated plugin so it never
 * short-circuits the Zod checks. Mirrors the Sales module's route wiring.
 */
export const purchaseRoutesPlugin: FastifyPluginAsync<PurchaseRoutesOptions> = (app, opts) => {
  const useCases = buildPurchaseUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // POST /api/v1/purchases — create (with transaction)
  app.post(
    '/',
    {
      schema: createPurchaseRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PURCHASES_FEATURE),
        app.authorize('purchases', 'list', 'write'),
      ],
    },
    async (request, reply) => {
      const { tenantId, userId } = requireActor(request);
      const body = validateBody(request, createPurchaseBodySchema);
      const input: CreatePurchaseInputDto = {
        tenantId,
        userId,
        supplierId: body.supplierId,
        items: body.items.map((item): CreatePurchaseLineInputDto => ({
          productId: item.productId,
          quantity: item.quantity,
          ...(item.unitCost !== undefined ? { unitCost: item.unitCost } : {}),
        })),
        ...(body.notes !== undefined && body.notes !== null ? { notes: body.notes } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      };
      const purchase = await useCases.create.execute(input);
      return reply.status(201).send(purchase);
    },
  );

  // GET /api/v1/purchases — list (filter by date/supplier/status)
  app.get(
    '/',
    {
      schema: listPurchasesRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PURCHASES_FEATURE),
        app.authorize('purchases', 'list', 'read'),
      ],
    },
    async (request, reply) => {
      const { tenantId } = requireActor(request);
      const query = validateQuery(request, listPurchasesQuerySchema);
      const input: ListPurchasesInputDto = {
        tenantId,
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.supplierId !== undefined ? { supplierId: query.supplierId } : {}),
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

  // GET /api/v1/purchases/:id — details (with line items)
  app.get(
    '/:id',
    {
      schema: getPurchaseRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PURCHASES_FEATURE),
        app.authorize('purchases', 'detail', 'read'),
      ],
    },
    async (request, reply) => {
      const { tenantId } = requireActor(request);
      const { id } = validateParams(request, purchaseIdParamSchema);
      const purchase = await useCases.get.execute({ id, tenantId });
      return reply.status(200).send(purchase);
    },
  );

  // PUT /api/v1/purchases/:id/status — update status (draft, completed, cancelled)
  app.put(
    '/:id/status',
    {
      schema: updatePurchaseStatusRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PURCHASES_FEATURE),
        app.authorize('purchases', 'detail', 'write'),
      ],
    },
    async (request, reply) => {
      const { tenantId } = requireActor(request);
      const { id } = validateParams(request, purchaseIdParamSchema);
      const body = validateBody(request, updatePurchaseStatusBodySchema);
      const input: UpdatePurchaseStatusInputDto = { id, tenantId, status: body.status };
      const purchase = await useCases.updateStatus.execute(input);
      return reply.status(200).send(purchase);
    },
  );

  // DELETE /api/v1/purchases/:id — soft delete
  app.delete(
    '/:id',
    {
      schema: deletePurchaseRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PURCHASES_FEATURE),
        app.authorize('purchases', 'detail', 'delete'),
      ],
    },
    async (request, reply) => {
      const { tenantId } = requireActor(request);
      const { id } = validateParams(request, purchaseIdParamSchema);
      await useCases.remove.execute({ id, tenantId });
      return reply.status(204).send();
    },
  );

  return Promise.resolve();
};

/**
 * Registers the purchase routes under the `/api/v1/purchases` prefix.
 *
 * Wraps {@link purchaseRoutesPlugin} in its own encapsulated context so the
 * relaxed validator compiler does not leak to other routes.
 */
export async function registerPurchaseRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(purchaseRoutesPlugin, { prefix: '/api/v1/purchases', container });
}
