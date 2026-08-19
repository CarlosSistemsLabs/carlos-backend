import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { CASH_TOKENS } from '@infrastructure/di/index.js';
import { FEATURES } from '@modules/subscriptions/index.js';
import { validateBody, validateQuery } from '@presentation/validators/index.js';
import type { RecordPaymentUseCase } from '../application/use-cases/record-payment.use-case.js';
import type { ListPaymentsUseCase } from '../application/use-cases/list-payments.use-case.js';
import type { GetPaymentStatusUseCase } from '../application/use-cases/get-payment-status.use-case.js';
import type {
  RecordPaymentInputDto,
  ListPaymentsInputDto,
  GetPaymentStatusInputDto,
} from '../application/dto/payment-dtos.js';
import {
  recordPaymentBodySchema,
  listPaymentsQuerySchema,
  paymentStatusQuerySchema,
  recordPaymentRouteSchema,
  listPaymentsRouteSchema,
  paymentStatusRouteSchema,
} from './payment.schemas.js';

/**
 * The feature key gating the Payment endpoints.
 *
 * Payments are part of the cash/finance capability, so they are gated behind
 * the same Business-tier `cash` feature as the register endpoints: the plan →
 * feature matrix (`PLAN_FEATURE_MATRIX`) grants `cash` from the Business tier
 * upward, so a tenant on Starter (or with no active subscription) is refused
 * with a 403 by the subscription/feature guard (Requirements 10.3, 10.4, 12.3,
 * 12.4).
 */
const PAYMENTS_FEATURE = FEATURES.CASH;

/** Bundle of the payment use cases wired from the DI container. */
interface PaymentUseCases {
  record: RecordPaymentUseCase;
  list: ListPaymentsUseCase;
  status: GetPaymentStatusUseCase;
}

/** Resolves the payment use cases from the composition container. */
export function buildPaymentUseCases(container: Container): PaymentUseCases {
  return {
    record: container.resolve(CASH_TOKENS.RecordPaymentUseCase),
    list: container.resolve(CASH_TOKENS.ListPaymentsUseCase),
    status: container.resolve(CASH_TOKENS.GetPaymentStatusUseCase),
  };
}

/** The authenticated identity a payment route needs (tenant scope + actor). */
interface PaymentActor {
  tenantId: string;
  userId: string;
}

/**
 * Returns the authenticated tenant id + user id from the request.
 *
 * Defence in depth: every payment route attaches `app.authenticate`, which
 * populates `request.auth`; should that be bypassed the handler still refuses
 * with a 401 rather than operating without a tenant scope (Requirement 1.5).
 * The payment's `userId` (author, stamped on any cash movement) is taken from
 * the token, never the client body, so authorship cannot be spoofed.
 */
function requireActor(request: FastifyRequest): PaymentActor {
  const auth = request.auth;
  if (auth === undefined) {
    throw new UnauthorizedError('Authentication required');
  }
  return { tenantId: auth.tenantId, userId: auth.userId };
}

/** Options accepted by the {@link paymentRoutesPlugin}. */
export interface PaymentRoutesOptions {
  /** Composition container with the cash infrastructure registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the payment endpoints under `/api/v1/payments`.
 *
 * Every route is protected: `app.authenticate` verifies the bearer token
 * (401 on failure), `app.requireFeature` enforces the subscription/feature
 * guard (403 when the tenant's plan does not grant `cash`) and
 * `app.authorize(module, screen, action)` enforces RBAC (403 when the role
 * lacks the permission). Inputs are validated with Zod via the shared
 * validators; validation failures map to the consistent 400 envelope, a missing
 * sale/purchase surfaces as 404 and an overpayment as 422 (the domain
 * `PaymentOverpaymentError` is a `BusinessRuleError`). The attached `schema`
 * objects document the routes for OpenAPI (Requirement 3.7); Fastify's own
 * validation is disabled inside this encapsulated plugin so it never
 * short-circuits the Zod checks. Mirrors the Purchases module wiring.
 */
export const paymentRoutesPlugin: FastifyPluginAsync<PaymentRoutesOptions> = (app, opts) => {
  const useCases = buildPaymentUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // POST /api/v1/payments — record a payment (against a sale or a purchase)
  app.post(
    '/',
    {
      schema: recordPaymentRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PAYMENTS_FEATURE),
        app.authorize('cash', 'payments', 'write'),
      ],
    },
    async (request, reply) => {
      const { tenantId, userId } = requireActor(request);
      const body = validateBody(request, recordPaymentBodySchema);
      const input: RecordPaymentInputDto = {
        tenantId,
        userId,
        method: body.method,
        amount: body.amount,
        ...(body.saleId !== undefined && body.saleId !== null ? { saleId: body.saleId } : {}),
        ...(body.purchaseId !== undefined && body.purchaseId !== null
          ? { purchaseId: body.purchaseId }
          : {}),
        ...(body.reference !== undefined && body.reference !== null
          ? { reference: body.reference }
          : {}),
        ...(body.cashId !== undefined && body.cashId !== null ? { cashId: body.cashId } : {}),
      };
      const payment = await useCases.record.execute(input);
      return reply.status(201).send(payment);
    },
  );

  // GET /api/v1/payments/status — derived payment status of a sale/purchase.
  // Registered BEFORE any parameterised route so it is never shadowed.
  app.get(
    '/status',
    {
      schema: paymentStatusRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PAYMENTS_FEATURE),
        app.authorize('cash', 'payments', 'read'),
      ],
    },
    async (request, reply) => {
      const { tenantId } = requireActor(request);
      const query = validateQuery(request, paymentStatusQuerySchema);
      const input: GetPaymentStatusInputDto = {
        tenantId,
        ...(query.saleId !== undefined ? { saleId: query.saleId } : {}),
        ...(query.purchaseId !== undefined ? { purchaseId: query.purchaseId } : {}),
      };
      const result = await useCases.status.execute(input);
      return reply.status(200).send(result);
    },
  );

  // GET /api/v1/payments — list payments (paginated + filterable)
  app.get(
    '/',
    {
      schema: listPaymentsRouteSchema,
      preHandler: [
        app.authenticate,
        app.requireFeature(PAYMENTS_FEATURE),
        app.authorize('cash', 'payments', 'read'),
      ],
    },
    async (request, reply) => {
      const { tenantId } = requireActor(request);
      const query = validateQuery(request, listPaymentsQuerySchema);
      const input: ListPaymentsInputDto = {
        tenantId,
        ...(query.page !== undefined ? { page: query.page } : {}),
        ...(query.pageSize !== undefined ? { pageSize: query.pageSize } : {}),
        ...(query.saleId !== undefined ? { saleId: query.saleId } : {}),
        ...(query.purchaseId !== undefined ? { purchaseId: query.purchaseId } : {}),
        ...(query.method !== undefined ? { method: query.method } : {}),
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
      };
      const result = await useCases.list.execute(input);
      return reply.status(200).send(result);
    },
  );

  return Promise.resolve();
};

/**
 * Registers the payment routes under the `/api/v1/payments` prefix.
 *
 * Wraps {@link paymentRoutesPlugin} in its own encapsulated context so the
 * relaxed validator compiler does not leak to other routes.
 */
export async function registerPaymentRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(paymentRoutesPlugin, { prefix: '/api/v1/payments', container });
}
