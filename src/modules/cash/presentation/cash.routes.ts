import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { CASH_TOKENS } from '@infrastructure/di/index.js';
import { FEATURES } from '@modules/subscriptions/index.js';
import { validateBody, validateQuery } from '@presentation/validators/index.js';
import type { OpenCashRegisterUseCase } from '../application/use-cases/open-cash-register.use-case.js';
import type { CloseCashRegisterUseCase } from '../application/use-cases/close-cash-register.use-case.js';
import type { RecordCashMovementUseCase } from '../application/use-cases/record-cash-movement.use-case.js';
import type { ListCashMovementsUseCase } from '../application/use-cases/list-cash-movements.use-case.js';
import type {
  OpenCashRegisterInputDto,
  CloseCashRegisterInputDto,
  RecordCashMovementInputDto,
  ListCashMovementsInputDto,
} from '../application/dto/cash-dtos.js';
import {
  openCashRegisterBodySchema,
  closeCashRegisterBodySchema,
  recordCashMovementBodySchema,
  listCashMovementsQuerySchema,
  openCashRegisterRouteSchema,
  closeCashRegisterRouteSchema,
  recordCashMovementRouteSchema,
  listCashMovementsRouteSchema,
} from './cash.schemas.js';

/**
 * The feature key gating the Cash module.
 *
 * Cash flow is a Business-tier feature: the canonical plan → feature matrix
 * (`PLAN_FEATURE_MATRIX`) grants `cash` from the Business tier upward, so a
 * tenant on Starter (or with no active subscription) is refused with a 403 by
 * the subscription/feature guard (Requirements 10.3, 10.4, 12.3, 12.4).
 */
const CASH_FEATURE = FEATURES.CASH;

/** Bundle of the cash-register + movement use cases wired from the DI container. */
interface CashUseCases {
  open: OpenCashRegisterUseCase;
  close: CloseCashRegisterUseCase;
  recordMovement: RecordCashMovementUseCase;
  listMovements: ListCashMovementsUseCase;
}

/** Resolves the cash-register use cases from the composition container. */
export function buildCashUseCases(container: Container): CashUseCases {
  return {
    open: container.resolve(CASH_TOKENS.OpenCashRegisterUseCase),
    close: container.resolve(CASH_TOKENS.CloseCashRegisterUseCase),
    recordMovement: container.resolve(CASH_TOKENS.RecordCashMovementUseCase),
    listMovements: container.resolve(CASH_TOKENS.ListCashMovementsUseCase),
  };
}

/** The authenticated identity a cash route needs (tenant scope + actor). */
interface CashActor {
  tenantId: string;
  userId: string;
}

/**
 * Returns the authenticated tenant id + user id from the request.
 *
 * Defence in depth: every cash route attaches `app.authenticate`, which
 * populates `request.auth`; should that be bypassed the handler still refuses
 * with a 401 rather than operating without a tenant scope (Requirement 1.5).
 * The movement's `userId` (author) is taken from the token, never the client
 * body, so authorship cannot be spoofed.
 */
function requireActor(request: FastifyRequest): CashActor {
  const auth = request.auth;
  if (auth === undefined) {
    throw new UnauthorizedError('Authentication required');
  }
  return { tenantId: auth.tenantId, userId: auth.userId };
}

/** Options accepted by the {@link cashRoutesPlugin}. */
export interface CashRoutesOptions {
  /** Composition container with the cash infrastructure registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the cash-register endpoints under `/api/v1/cash`.
 *
 * Every route is protected: `app.authenticate` verifies the bearer token
 * (401 on failure), `app.requireFeature` enforces the subscription/feature
 * guard (403 when the tenant's plan does not grant `cash`) and
 * `app.authorize(module, screen, action)` enforces RBAC (403 when the role
 * lacks the permission). Inputs are validated with Zod via the shared
 * validators; validation failures map to the consistent 400 envelope, while an
 * overdraft on a movement (or a shortage that would overdraw at close) surfaces
 * as 422 (the domain `InsufficientCashBalanceError` is a `BusinessRuleError`).
 * The attached `schema` objects document the routes for OpenAPI (Requirement
 * 3.7); Fastify's own validation is disabled inside this encapsulated plugin so
 * it never short-circuits the Zod checks. Mirrors the Purchases module wiring.
 */
export const cashRoutesPlugin: FastifyPluginAsync<CashRoutesOptions> = (app, opts) => {
  const useCases = buildCashUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // POST /api/v1/cash/open — open a register (with optional opening float)
  app.post(
    '/open',
    {
      schema: openCashRegisterRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CASH_FEATURE),
        app.authorize('cash', 'register', 'write'),
      ],
    },
    async (request, reply) => {
      const { tenantId, userId } = requireActor(request);
      const body = validateBody(request, openCashRegisterBodySchema);
      const input: OpenCashRegisterInputDto = {
        tenantId,
        userId,
        name: body.name,
        ...(body.branchId !== undefined ? { branchId: body.branchId } : {}),
        ...(body.openingBalance !== undefined ? { openingBalance: body.openingBalance } : {}),
      };
      const cash = await useCases.open.execute(input);
      return reply.status(201).send(cash);
    },
  );

  // POST /api/v1/cash/close — close a register with reconciliation
  app.post(
    '/close',
    {
      schema: closeCashRegisterRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CASH_FEATURE),
        app.authorize('cash', 'register', 'write'),
      ],
    },
    async (request, reply) => {
      const { tenantId, userId } = requireActor(request);
      const body = validateBody(request, closeCashRegisterBodySchema);
      const input: CloseCashRegisterInputDto = {
        tenantId,
        userId,
        cashId: body.cashId,
        countedAmount: body.countedAmount,
      };
      const result = await useCases.close.execute(input);
      return reply.status(200).send(result);
    },
  );

  // POST /api/v1/cash/movements — record a standalone cash movement
  app.post(
    '/movements',
    {
      schema: recordCashMovementRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CASH_FEATURE),
        app.authorize('cash', 'register', 'write'),
      ],
    },
    async (request, reply) => {
      const { tenantId, userId } = requireActor(request);
      const body = validateBody(request, recordCashMovementBodySchema);
      const input: RecordCashMovementInputDto = {
        tenantId,
        userId,
        cashId: body.cashId,
        type: body.type,
        category: body.category,
        amount: body.amount,
        ...(body.reference !== undefined && body.reference !== null
          ? { reference: body.reference }
          : {}),
        ...(body.description !== undefined && body.description !== null
          ? { description: body.description }
          : {}),
      };
      const movement = await useCases.recordMovement.execute(input);
      return reply.status(201).send(movement);
    },
  );

  // GET /api/v1/cash/movements — cash-flow history (paginated + filterable)
  app.get(
    '/movements',
    {
      schema: listCashMovementsRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(CASH_FEATURE),
        app.authorize('cash', 'movements', 'read'),
      ],
    },
    async (request, reply) => {
      const { tenantId } = requireActor(request);
      const query = validateQuery(request, listCashMovementsQuerySchema);
      const input: ListCashMovementsInputDto = {
        tenantId,
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.cashId !== undefined ? { cashId: query.cashId } : {}),
        ...(query.type !== undefined ? { type: query.type } : {}),
        ...(query.category !== undefined ? { category: query.category } : {}),
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
      };
      const result = await useCases.listMovements.execute(input);
      return reply.status(200).send(result);
    },
  );

  return Promise.resolve();
};

/**
 * Registers the cash routes under the `/api/v1/cash` prefix.
 *
 * Wraps {@link cashRoutesPlugin} in its own encapsulated context so the relaxed
 * validator compiler does not leak to other routes.
 */
export async function registerCashRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(cashRoutesPlugin, { prefix: '/api/v1/cash', container });
}
