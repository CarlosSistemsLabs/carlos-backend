import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Container, INFRASTRUCTURE_TOKENS } from '@infrastructure/di/index.js';
import { registerErrorHandler } from '@presentation/middlewares/error-handler.js';
import { registerAuthentication } from '@presentation/middlewares/authentication.js';
import { registerAuthorization } from '@presentation/middlewares/authorization.js';
import { registerFeatureFlagAuthorization } from '@presentation/middlewares/feature-flag.js';
import type { UUID } from '@shared/types/index.js';
import { JwtTokenService } from '../../modules/auth/infrastructure/jwt-token-service.js';
import { AuthUser } from '../../modules/auth/domain/entities/auth-user.js';
import { Role } from '../../modules/authorization/domain/entities/role.js';
import { Permission } from '../../modules/authorization/domain/value-objects/permission.js';
import type { IRoleRepository } from '../../modules/authorization/domain/repositories/role-repository.js';
import type {
  FeatureAccessDecision,
  IFeatureAccessService,
} from '../../modules/subscriptions/domain/services/feature-access-service.js';
import { ResilientAIService } from '../resilient-ai-service.js';
import type { AIProvider } from '../ai-provider.js';
import type { AICompletionRequest, AICompletionResponse } from '../ai-service.js';
import { registerAiRoutes } from './ai.routes.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const ADMIN_ROLE_ID = '33333333-3333-3333-3333-333333333333';
const READER_ROLE_ID = '44444444-4444-4444-4444-444444444444';

// ---------------------------------------------------------------------------
// Fakes (no live provider SDK, no network, no real timers)
// ---------------------------------------------------------------------------

/** Canned provider that echoes a deterministic completion with usage. */
class CannedAIProvider implements AIProvider {
  readonly kind = 'openai' as const;

  complete(request: AICompletionRequest): Promise<AICompletionResponse> {
    return Promise.resolve({
      text: `answer to: ${request.prompt}`,
      provider: this.kind,
      model: 'canned-model',
      usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 },
      finishReason: 'stop',
    });
  }
}

class InMemoryRoleRepository implements IRoleRepository {
  private readonly byId = new Map<UUID, Role>();

  seed(role: Role): void {
    this.byId.set(role.id, role);
  }

  async findById(id: UUID): Promise<Role | null> {
    return this.byId.get(id) ?? null;
  }

  async findByTenant(tenantId: UUID): Promise<Role[]> {
    return [...this.byId.values()].filter((r) => r.tenantId === tenantId);
  }

  async findByName(tenantId: UUID, name: string): Promise<Role | null> {
    for (const role of this.byId.values()) {
      if (role.tenantId === tenantId && role.name === name) {
        return role;
      }
    }
    return null;
  }

  async create(role: Role): Promise<Role> {
    this.byId.set(role.id, role);
    return role;
  }

  async update(role: Role): Promise<Role> {
    this.byId.set(role.id, role);
    return role;
  }

  async addPermissions(role: Role): Promise<Role> {
    this.byId.set(role.id, role);
    return role;
  }

  async replacePermissions(role: Role): Promise<Role> {
    this.byId.set(role.id, role);
    return role;
  }
}

class AllowAllFeatureAccessService implements IFeatureAccessService {
  async checkFeatureAccess(): Promise<FeatureAccessDecision> {
    return { allowed: true };
  }

  async isFeatureEnabled(): Promise<boolean> {
    return true;
  }
}

class DenyAllFeatureAccessService implements IFeatureAccessService {
  async checkFeatureAccess(): Promise<FeatureAccessDecision> {
    return { allowed: false, reason: 'plan_excludes_feature' };
  }

  async isFeatureEnabled(): Promise<boolean> {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test app builder
// ---------------------------------------------------------------------------

interface TestAppOptions {
  /** When true (default), the caller has the Admin (wildcard) role. */
  fullAccess?: boolean;
  /** When true (default), the tenant's plan grants the `ai` feature. */
  featureAllowed?: boolean;
  /** When true, the AI service is configured with a canned provider (enabled). */
  aiEnabled?: boolean;
}

interface TestApp {
  app: FastifyInstance;
  token: string;
}

async function buildTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const fullAccess = options.fullAccess ?? true;
  const featureAllowed = options.featureAllowed ?? true;
  const aiEnabled = options.aiEnabled ?? true;

  const tokenService = await JwtTokenService.withEphemeralKeys({ issuer: 'carlos-erp' });

  const roles = new InMemoryRoleRepository();
  roles.seed(
    Role.create(
      {
        tenantId: TENANT_ID,
        name: 'Admin',
        permissions: [Permission.create('*', '*', '*')],
      },
      ADMIN_ROLE_ID,
    ),
  );
  // A role that can read sales but has NO ai permission, so it is refused the AI
  // endpoints with a 403 (RBAC), independent of the feature guard.
  roles.seed(
    Role.create(
      {
        tenantId: TENANT_ID,
        name: 'Reader',
        permissions: [Permission.create('sales', '*', 'read')],
      },
      READER_ROLE_ID,
    ),
  );

  const roleId = fullAccess ? ADMIN_ROLE_ID : READER_ROLE_ID;
  const user = AuthUser.reconstitute(USER_ID, {
    tenantId: TENANT_ID,
    email: 'ada@example.com',
    passwordHash: 'hash',
    firstName: 'Ada',
    lastName: 'Lovelace',
    roleId,
    phone: null,
    avatar: null,
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
  });
  const token = await tokenService.issueAccessToken(user);

  const container = new Container();
  container.registerValue(
    INFRASTRUCTURE_TOKENS.AIService,
    new ResilientAIService({
      providers: aiEnabled ? [new CannedAIProvider()] : [],
      logger: { info: () => undefined },
    }),
  );

  const app = Fastify();
  registerErrorHandler(app);
  registerAuthentication(app, tokenService);
  registerAuthorization(app, roles);
  registerFeatureFlagAuthorization(
    app,
    featureAllowed ? new AllowAllFeatureAccessService() : new DenyAllFeatureAccessService(),
  );
  await registerAiRoutes(app, container);
  await app.ready();

  return { app, token };
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

const AI_PATHS = [
  '/api/v1/ai/sales-assistant',
  '/api/v1/ai/query',
  '/api/v1/ai/report-generate',
] as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ai routes', () => {
  let ctx: TestApp;

  afterEach(async () => {
    await ctx.app.close();
  });

  describe('authentication & authorization', () => {
    it('returns 401 when unauthenticated', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/ai/sales-assistant',
        payload: { message: 'hi' },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('guards every AI endpoint against unauthenticated access', async () => {
      ctx = await buildTestApp();
      for (const url of AI_PATHS) {
        const response = await ctx.app.inject({ method: 'POST', url, payload: {} });
        expect(response.statusCode).toBe(401);
      }
    });

    it('returns 403 when the tenant subscription does not grant the ai feature', async () => {
      ctx = await buildTestApp({ featureAllowed: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/ai/sales-assistant',
        headers: authHeader(ctx.token),
        payload: { message: 'hi' },
      });
      expect(response.statusCode).toBe(403);
    });

    it('returns 403 when the role lacks the ai permission', async () => {
      ctx = await buildTestApp({ fullAccess: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/ai/query',
        headers: authHeader(ctx.token),
        payload: { question: 'how many sales?' },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error_code).toBe('FORBIDDEN');
    });
  });

  describe('POST /api/v1/ai/sales-assistant', () => {
    it('returns 200 with the assistant reply and usage', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/ai/sales-assistant',
        headers: authHeader(ctx.token),
        payload: {
          message: 'What should I upsell?',
          history: [{ role: 'user', content: 'hello' }],
        },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.reply).toContain('What should I upsell?');
      expect(body.usage).toMatchObject({ totalTokens: 8 });
    });

    it('returns 400 when message is missing', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/ai/sales-assistant',
        headers: authHeader(ctx.token),
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('degrades gracefully to a 200 fallback when no AI provider is configured', async () => {
      ctx = await buildTestApp({ aiEnabled: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/ai/sales-assistant',
        headers: authHeader(ctx.token),
        payload: { message: 'hi' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.degraded).toBe(true);
      expect(body.available).toBe(false);
      expect(typeof body.reply).toBe('string');
      expect(body.reply.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/ai/query', () => {
    it('returns 200 with the natural-language answer', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/ai/query',
        headers: authHeader(ctx.token),
        payload: { question: 'top 5 products last month' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().answer).toContain('top 5 products last month');
    });

    it('returns 400 when question is missing', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/ai/query',
        headers: authHeader(ctx.token),
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('degrades gracefully to a 200 fallback when no AI provider is configured', async () => {
      ctx = await buildTestApp({ aiEnabled: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/ai/query',
        headers: authHeader(ctx.token),
        payload: { question: 'anything' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.degraded).toBe(true);
      expect(body.available).toBe(false);
      expect(typeof body.answer).toBe('string');
      expect(body.answer.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/ai/report-generate', () => {
    it('returns 200 with the generated narrative', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/ai/report-generate',
        headers: authHeader(ctx.token),
        payload: {
          prompt: 'Summarize Q1 sales',
          reportType: 'sales',
          data: [{ month: 'Jan', total: 100 }],
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().narrative).toContain('Summarize Q1 sales');
    });

    it('returns 400 when prompt is missing', async () => {
      ctx = await buildTestApp();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/ai/report-generate',
        headers: authHeader(ctx.token),
        payload: { reportType: 'sales' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });

    it('degrades gracefully to a 200 fallback when no AI provider is configured', async () => {
      ctx = await buildTestApp({ aiEnabled: false });
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/v1/ai/report-generate',
        headers: authHeader(ctx.token),
        payload: { prompt: 'anything' },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.degraded).toBe(true);
      expect(body.available).toBe(false);
      expect(typeof body.narrative).toBe('string');
      expect(body.narrative.length).toBeGreaterThan(0);
    });
  });
});
