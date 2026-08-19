import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { registerErrorHandler } from './error-handler.js';
import { registerAuthentication } from './authentication.js';
import { JwtTokenService } from '@modules/auth/index.js';
import { AuthUser } from '@modules/auth/index.js';

function makeUser(): AuthUser {
  return AuthUser.reconstitute('user-123', {
    tenantId: 'tenant-abc',
    email: 'ada@example.com',
    passwordHash: 'hash',
    firstName: 'Ada',
    lastName: 'Lovelace',
    roleId: 'role-xyz',
    phone: null,
    avatar: null,
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
  });
}

describe('authentication middleware', () => {
  let app: FastifyInstance;
  let tokenService: JwtTokenService;

  beforeAll(async () => {
    tokenService = await JwtTokenService.withEphemeralKeys({ issuer: 'carlos-erp' });

    app = Fastify();
    registerErrorHandler(app);
    registerAuthentication(app, tokenService);

    app.get('/protected', { preHandler: app.authenticate }, (request) => {
      return { auth: request.auth };
    });
    app.get('/public', () => ({ ok: true }));

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('attaches the verified payload to request.auth on a valid token', async () => {
    const token = await tokenService.issueAccessToken(makeUser());

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      auth: { tenantId: 'tenant-abc', userId: 'user-123', roleId: 'role-xyz' },
    });
  });

  it('returns 401 when the Authorization header is missing', async () => {
    const response = await app.inject({ method: 'GET', url: '/protected' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error_code).toBe('UNAUTHORIZED');
  });

  it('returns 401 when the Authorization header is malformed', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Token abc' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error_code).toBe('UNAUTHORIZED');
  });

  it('returns 401 on an invalid/garbage token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer not-a-real-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error_code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a token signed by a foreign key', async () => {
    const foreign = await JwtTokenService.withEphemeralKeys({ issuer: 'carlos-erp' });
    const token = await foreign.issueAccessToken(makeUser());

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('leaves public routes accessible without a token', async () => {
    const response = await app.inject({ method: 'GET', url: '/public' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });
});
