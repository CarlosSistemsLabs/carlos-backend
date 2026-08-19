import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Container, AUTH_TOKENS } from '@infrastructure/di/index.js';
import { registerErrorHandler } from '@presentation/middlewares/error-handler.js';
import { registerAuthRoutes } from './auth.routes.js';
import { AuthUser } from '../domain/entities/auth-user.js';
import { JwtTokenService } from '../infrastructure/jwt-token-service.js';
import type { IUserRepository } from '../domain/repositories/user-repository.js';
import type {
  CreateRefreshTokenInput,
  IRefreshTokenRepository,
  RefreshTokenRecord,
} from '../domain/repositories/refresh-token-repository.js';
import type { IAuthEventLogger } from '../application/ports/auth-event-logger.js';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const ROLE_ID = '22222222-2222-2222-2222-222222222222';

// ---------------------------------------------------------------------------
// In-memory fakes (no live database / no mocks of business logic)
// ---------------------------------------------------------------------------

class InMemoryUserRepository implements IUserRepository {
  private readonly byId = new Map<string, AuthUser>();
  private idCounter = 0;

  async findByEmail(tenantId: string, email: string): Promise<AuthUser | null> {
    for (const user of this.byId.values()) {
      if (user.tenantId === tenantId && user.email === email) {
        return user;
      }
    }
    return null;
  }

  async findById(id: string): Promise<AuthUser | null> {
    return this.byId.get(id) ?? null;
  }

  async create(user: AuthUser): Promise<AuthUser> {
    const id = `user-${(this.idCounter += 1)}`;
    const stored = AuthUser.reconstitute(id, {
      tenantId: user.tenantId,
      email: user.email,
      passwordHash: user.passwordHash,
      firstName: user.firstName,
      lastName: user.lastName,
      roleId: user.roleId,
      phone: user.phone,
      avatar: user.avatar,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      failedLoginCount: user.failedLoginCount,
      lockedUntil: user.lockedUntil,
    });
    this.byId.set(id, stored);
    return stored;
  }

  async update(user: AuthUser): Promise<AuthUser> {
    this.byId.set(user.id, user);
    return user;
  }
}

class InMemoryRefreshTokenRepository implements IRefreshTokenRepository {
  private readonly byToken = new Map<string, RefreshTokenRecord>();
  private idCounter = 0;

  async create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord> {
    const record: RefreshTokenRecord = {
      id: `rt-${(this.idCounter += 1)}`,
      userId: input.userId,
      token: input.token,
      expiresAt: input.expiresAt,
      isRevoked: false,
      createdAt: new Date(),
    };
    this.byToken.set(input.token, record);
    return record;
  }

  async findByToken(token: string): Promise<RefreshTokenRecord | null> {
    return this.byToken.get(token) ?? null;
  }

  async revoke(token: string): Promise<void> {
    const record = this.byToken.get(token);
    if (record !== undefined) {
      this.byToken.set(token, { ...record, isRevoked: true });
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    for (const [token, record] of this.byToken.entries()) {
      if (record.userId === userId) {
        this.byToken.set(token, { ...record, isRevoked: true });
      }
    }
  }
}

const noopAuthEvents: IAuthEventLogger = {
  loginSucceeded: () => undefined,
  loginFailed: () => undefined,
  accountLocked: () => undefined,
  tokenRefreshed: () => undefined,
  logout: () => undefined,
};

async function buildTestApp(): Promise<FastifyInstance> {
  const container = new Container();
  const tokenService = await JwtTokenService.withEphemeralKeys({ issuer: 'carlos-erp' });

  container.registerValue(AUTH_TOKENS.TokenService, tokenService);
  container.registerValue(AUTH_TOKENS.UserRepository, new InMemoryUserRepository());
  container.registerValue(
    AUTH_TOKENS.RefreshTokenRepository,
    new InMemoryRefreshTokenRepository(),
  );
  container.registerValue(AUTH_TOKENS.AuthEventLogger, noopAuthEvents);

  const app = Fastify();
  registerErrorHandler(app);
  await registerAuthRoutes(app, container);
  await app.ready();
  return app;
}

function registerPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tenantId: TENANT_ID,
    email: 'ada@example.com',
    password: 'Sup3rSecret',
    firstName: 'Ada',
    lastName: 'Lovelace',
    roleId: ROLE_ID,
    ...overrides,
  };
}

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/register', () => {
    it('registers a new user and returns 201 with a safe projection', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: registerPayload(),
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).toMatchObject({
        tenantId: TENANT_ID,
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        roleId: ROLE_ID,
        isActive: true,
      });
      expect(body.id).toBeTypeOf('string');
      // Never leak the password hash.
      expect(body).not.toHaveProperty('passwordHash');
      expect(body).not.toHaveProperty('password');
    });

    it('returns 400 when the body is invalid', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: registerPayload({ email: 'not-an-email', tenantId: 'nope' }),
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error_code).toBe('VALIDATION_ERROR');
      expect(body.details.fields).toBeInstanceOf(Array);
    });

    it('returns 409 when the email already exists for the tenant', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: registerPayload(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: registerPayload(),
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error_code).toBe('CONFLICT');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('authenticates a registered user and returns tokens', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: registerPayload(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { tenantId: TENANT_ID, email: 'ada@example.com', password: 'Sup3rSecret' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.accessToken).toBeTypeOf('string');
      expect(body.refreshToken).toBeTypeOf('string');
      expect(body.user).toMatchObject({ email: 'ada@example.com', tenantId: TENANT_ID });
      expect(body.user).not.toHaveProperty('passwordHash');
    });

    it('returns 401 on invalid credentials', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: registerPayload(),
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { tenantId: TENANT_ID, email: 'ada@example.com', password: 'WrongPass1' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 400 when required fields are missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'ada@example.com' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('rotates the refresh token and returns a new pair', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: registerPayload(),
      });
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { tenantId: TENANT_ID, email: 'ada@example.com', password: 'Sup3rSecret' },
      });
      const { refreshToken } = login.json();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.accessToken).toBeTypeOf('string');
      expect(body.refreshToken).toBeTypeOf('string');
      expect(body.refreshToken).not.toBe(refreshToken);
    });

    it('returns 401 on an invalid/unknown refresh token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: 'totally-bogus-token' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error_code).toBe('UNAUTHORIZED');
    });

    it('returns 400 when the refresh token is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes the refresh token and returns 204', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: registerPayload(),
      });
      const login = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { tenantId: TENANT_ID, email: 'ada@example.com', password: 'Sup3rSecret' },
      });
      const { refreshToken } = login.json();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken },
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');

      // The revoked token can no longer be refreshed.
      const refresh = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken },
      });
      expect(refresh.statusCode).toBe(401);
    });

    it('is idempotent for an unknown token (still 204)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken: 'unknown-token' },
      });

      expect(response.statusCode).toBe(204);
    });

    it('returns 400 when the refresh token is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error_code).toBe('VALIDATION_ERROR');
    });
  });
});
