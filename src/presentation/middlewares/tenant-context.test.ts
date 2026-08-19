import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect } from 'vitest';
import { getTenantId, getUserId } from '@common/context';
import { registerRequestContext } from './request-context.js';
import {
  registerTenantContext,
  propagateTenantContext,
  type AuthenticatedPayload,
} from './tenant-context.js';

const PAYLOAD: AuthenticatedPayload = {
  tenantId: 'tenant-123',
  userId: 'user-456',
  roleId: 'role-789',
};

/**
 * Builds an app wired like the real pipeline: the request context is seeded
 * first, then an optional stub `onRequest` hook attaches a verified payload to
 * mimic the auth middleware (task 8.2), then the tenant-context hook runs.
 */
function buildApp(stubAuth?: AuthenticatedPayload): FastifyInstance {
  const app = Fastify({ logger: false });
  registerRequestContext(app);
  if (stubAuth !== undefined) {
    app.addHook('onRequest', (request, _reply, done) => {
      request.auth = stubAuth;
      done();
    });
  }
  registerTenantContext(app);
  app.get('/whoami', () => ({
    tenantId: getTenantId() ?? null,
    userId: getUserId() ?? null,
  }));
  return app;
}

describe('propagateTenantContext', () => {
  it('is a no-op when no verified payload is present', () => {
    // Outside a request scope setTenantId/setUserId are themselves no-ops, so
    // this simply asserts the function does not throw when auth is absent.
    expect(() => propagateTenantContext({})).not.toThrow();
  });
});

describe('tenant-context hook', () => {
  it('propagates a present payload into the request context', async () => {
    const app = buildApp(PAYLOAD);
    const response = await app.inject({ method: 'GET', url: '/whoami' });
    expect(response.json()).toEqual({ tenantId: 'tenant-123', userId: 'user-456' });
    await app.close();
  });

  it('leaves the context unpopulated when no payload is attached', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/whoami' });
    expect(response.json()).toEqual({ tenantId: null, userId: null });
    await app.close();
  });
});
