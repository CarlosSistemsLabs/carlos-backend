import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { Container } from '@infrastructure/di/index.js';
import { SUBSCRIPTION_TOKENS } from '@infrastructure/di/index.js';
import { validateBody, validateParams } from '@presentation/validators/index.js';
import type { CreateSubscriptionUseCase } from '../application/use-cases/create-subscription.use-case.js';
import type { GetCurrentSubscriptionUseCase } from '../application/use-cases/get-current-subscription.use-case.js';
import type { UpgradeSubscriptionUseCase } from '../application/use-cases/upgrade-subscription.use-case.js';
import type { ListPlansUseCase } from '../application/use-cases/list-plans.use-case.js';
import type {
  CreateSubscriptionInputDto,
  UpgradeSubscriptionInputDto,
} from '../application/dto/subscription-dtos.js';
import {
  createSubscriptionBodySchema,
  upgradeSubscriptionBodySchema,
  subscriptionIdParamSchema,
  createSubscriptionRouteSchema,
  getCurrentSubscriptionRouteSchema,
  upgradeSubscriptionRouteSchema,
  listPlansRouteSchema,
} from './subscription.schemas.js';

/**
 * RBAC module + screen/action gating subscription MANAGEMENT (create/upgrade).
 *
 * **Access-control decision.** Subscribing a tenant to a plan and switching
 * plans is a billing/administration operation. It lives under the
 * `administration` module in the seeded permission matrix with a dedicated
 * `subscription` screen — only the Admin system role holds any `administration`
 * grant (via its `*:*:*` wildcard) — so create/upgrade require
 * `administration:subscription:write`. Reading the current subscription and
 * listing the plan catalogue, by contrast, are gated by authentication ALONE:
 * any authenticated tenant user may view their own plan or browse the catalogue
 * to choose one, so those endpoints deliberately attach no `authorize` guard.
 */
const ADMIN_MODULE = 'administration';
const SUBSCRIPTION_SCREEN = 'subscription';

/**
 * **`requireFeature` exemption (important).** Subscription management is
 * deliberately NOT placed behind `app.requireFeature`. The feature guard denies
 * a tenant with no active — or an expired — subscription; gating re-subscription
 * behind it would trap such a tenant in a state where they could never
 * re-subscribe or upgrade to restore access. Subscription management must always
 * be reachable (subject to authentication and, for writes, the admin RBAC
 * grant) regardless of the tenant's current feature entitlements. The plan
 * catalogue and current-subscription reads are likewise exempt.
 */

/** Bundle of the subscription use cases wired from the DI container. */
interface SubscriptionUseCases {
  create: CreateSubscriptionUseCase;
  getCurrent: GetCurrentSubscriptionUseCase;
  upgrade: UpgradeSubscriptionUseCase;
}

/** Resolves the subscription-management use cases from the composition container. */
export function buildSubscriptionUseCases(container: Container): SubscriptionUseCases {
  return {
    create: container.resolve(SUBSCRIPTION_TOKENS.CreateSubscriptionUseCase),
    getCurrent: container.resolve(SUBSCRIPTION_TOKENS.GetCurrentSubscriptionUseCase),
    upgrade: container.resolve(SUBSCRIPTION_TOKENS.UpgradeSubscriptionUseCase),
  };
}

/**
 * Returns the authenticated tenant id from the request, refusing with a 401
 * when the token/`request.auth` is absent (defence in depth — Requirement 1.5).
 * The tenant is ALWAYS taken from the token, never the client body, so a caller
 * can never manage another tenant's subscription.
 */
function requireTenantId(request: FastifyRequest): string {
  const auth = request.auth;
  if (auth === undefined) {
    throw new UnauthorizedError('Authentication required');
  }
  return auth.tenantId;
}

/** Options accepted by the subscription/plan route plugins. */
export interface SubscriptionRoutesOptions {
  /** Composition container with the subscription use cases registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the subscription-management endpoints under
 * `/api/v1/subscriptions`.
 *
 * - `POST /api/v1/subscriptions` → subscribe to a plan (admin only). 201 on
 *   success; 404 when the plan does not exist; 422 when the plan is retired
 *   (inactive). Supersedes any prior active subscription.
 * - `GET /api/v1/subscriptions/current` → the caller tenant's current
 *   subscription + plan (any authenticated user). 200, or 404 when the tenant
 *   has no active subscription. Registered BEFORE the `/:id` route.
 * - `PUT /api/v1/subscriptions/:id/upgrade` → switch the subscription to a
 *   different plan (admin only). 200 on success; 404 when the subscription (in
 *   the caller's tenant) or the target plan does not exist; 422 when the target
 *   plan is retired.
 *
 * None of these routes is feature-gated (see the `requireFeature` exemption
 * note above). Writes additionally require the `administration:subscription:write`
 * RBAC grant. Inputs are validated with Zod via the shared validators;
 * validation failures map to the consistent 400 envelope. Fastify's own
 * validation is disabled inside this encapsulated plugin so it never
 * short-circuits the Zod checks.
 */
export const subscriptionRoutesPlugin: FastifyPluginAsync<SubscriptionRoutesOptions> = (
  app,
  opts,
) => {
  const useCases = buildSubscriptionUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent error envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // POST /api/v1/subscriptions — subscribe to a plan (admin only)
  app.post(
    '/',
    {
      schema: createSubscriptionRouteSchema,
      preHandler: [app.authenticate, app.authorize(ADMIN_MODULE, SUBSCRIPTION_SCREEN, 'write')],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const body = validateBody(request, createSubscriptionBodySchema);
      const input: CreateSubscriptionInputDto = { tenantId, planId: body.planId };
      const subscription = await useCases.create.execute(input);
      return reply.status(201).send(subscription);
    },
  );

  // GET /api/v1/subscriptions/current — current subscription + plan (any user).
  // Registered BEFORE `/:id/...` so the literal `current` never gets captured
  // as an `:id` path parameter.
  app.get(
    '/current',
    {
      schema: getCurrentSubscriptionRouteSchema,
      preHandler: [app.authenticate],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const current = await useCases.getCurrent.execute({ tenantId });
      return reply.status(200).send(current);
    },
  );

  // PUT /api/v1/subscriptions/:id/upgrade — switch plan (admin only)
  app.put(
    '/:id/upgrade',
    {
      schema: upgradeSubscriptionRouteSchema,
      preHandler: [app.authenticate, app.authorize(ADMIN_MODULE, SUBSCRIPTION_SCREEN, 'write')],
    },
    async (request, reply) => {
      const tenantId = requireTenantId(request);
      const { id } = validateParams(request, subscriptionIdParamSchema);
      const body = validateBody(request, upgradeSubscriptionBodySchema);
      const input: UpgradeSubscriptionInputDto = {
        tenantId,
        subscriptionId: id,
        planId: body.planId,
      };
      const subscription = await useCases.upgrade.execute(input);
      return reply.status(200).send(subscription);
    },
  );

  return Promise.resolve();
};

/**
 * Fastify plugin exposing the public plan catalogue under `/api/v1/plans`.
 *
 * - `GET /api/v1/plans` → the active plans available for subscription (any
 *   authenticated user). Not feature-gated and not admin-gated: any tenant user
 *   may browse the catalogue to choose or compare a plan.
 */
export const planRoutesPlugin: FastifyPluginAsync<SubscriptionRoutesOptions> = (app, opts) => {
  const listPlans: ListPlansUseCase = opts.container.resolve(SUBSCRIPTION_TOKENS.ListPlansUseCase);

  app.setValidatorCompiler(() => (data) => ({ value: data }));

  // GET /api/v1/plans — list active plans (any authenticated user)
  app.get(
    '/',
    {
      schema: listPlansRouteSchema,
      preHandler: [app.authenticate],
    },
    async (_request, reply) => {
      const plans = await listPlans.execute();
      return reply.status(200).send(plans);
    },
  );

  return Promise.resolve();
};

/**
 * Registers the subscription-management routes under `/api/v1/subscriptions`
 * and the public plan catalogue under `/api/v1/plans`.
 *
 * Each plugin is wrapped in its own encapsulated context so the relaxed
 * validator compiler does not leak to other routes.
 */
export async function registerSubscriptionRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(subscriptionRoutesPlugin, { prefix: '/api/v1/subscriptions', container });
  await app.register(planRoutesPlugin, { prefix: '/api/v1/plans', container });
}
