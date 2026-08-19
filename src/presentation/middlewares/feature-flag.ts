import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import {
  FeatureDisabledError,
  SubscriptionRequiredError,
  type IFeatureAccessService,
} from '@modules/subscriptions/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Route-level guard factory that authorizes access to a named feature for
     * the authenticated tenant. Attach it after {@link FastifyInstance.authenticate}:
     * `{ preHandler: [app.authenticate, app.requireFeature('stock')] }`.
     */
    requireFeature: (feature: string) => preHandlerHookHandler;
  }
}

/**
 * Builds a Fastify `preHandler` that authorizes access to `feature` for the
 * authenticated tenant (Requirements 10.4, 12.3, 12.4).
 *
 * It requires {@link FastifyInstance.authenticate} to have run first so
 * `request.auth` is populated; an unauthenticated request yields a 401 via
 * {@link UnauthorizedError}. It then resolves feature access through the
 * injected {@link IFeatureAccessService} and, on denial, throws the
 * appropriate 403:
 *
 * - `feature_flag_disabled` → {@link FeatureDisabledError} (the plan allows the
 *   feature but a tenant flag explicitly disables it).
 * - every other reason (no active subscription, expired subscription, plan does
 *   not include the feature) → {@link SubscriptionRequiredError}.
 *
 * All errors are mapped to the consistent error envelope by the central error
 * handler (Requirement 12.2).
 */
export function createRequireFeaturePreHandler(
  featureAccessService: IFeatureAccessService,
  feature: string,
): (request: FastifyRequest) => Promise<void> {
  return async function requireFeature(request: FastifyRequest): Promise<void> {
    const auth = request.auth;
    if (auth === undefined) {
      throw new UnauthorizedError('Authentication required');
    }

    const decision = await featureAccessService.checkFeatureAccess(auth.tenantId, feature);
    if (decision.allowed) {
      return;
    }

    if (decision.reason === 'feature_flag_disabled') {
      throw new FeatureDisabledError(feature);
    }
    throw new SubscriptionRequiredError(feature, decision.reason);
  };
}

/**
 * Registers the feature-flag authorization guard as the `requireFeature`
 * decorator on the Fastify instance, wired to the given
 * {@link IFeatureAccessService}. Routes then guard a feature with
 * `{ preHandler: [app.authenticate, app.requireFeature('stock')] }`.
 */
export function registerFeatureFlagAuthorization(
  app: FastifyInstance,
  featureAccessService: IFeatureAccessService,
): void {
  app.decorate('requireFeature', (feature: string) =>
    createRequireFeaturePreHandler(featureAccessService, feature),
  );
}
