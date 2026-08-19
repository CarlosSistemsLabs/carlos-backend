import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { Container } from '@infrastructure/di/index.js';
import { AUTH_TOKENS } from '@infrastructure/di/index.js';
import { validateBody } from '@presentation/validators/index.js';
import { RegisterUserUseCase } from '../application/use-cases/register-user.use-case.js';
import { LoginUserUseCase } from '../application/use-cases/login-user.use-case.js';
import { RefreshTokenUseCase } from '../application/use-cases/refresh-token.use-case.js';
import { LogoutUseCase } from '../application/use-cases/logout.use-case.js';
import { BcryptPasswordHasher } from '../infrastructure/bcrypt-password-hasher.js';
import type { RegisterUserInput } from '../application/dto/auth-dtos.js';
import {
  registerBodySchema,
  loginBodySchema,
  refreshBodySchema,
  logoutBodySchema,
  registerRouteSchema,
  loginRouteSchema,
  refreshRouteSchema,
  logoutRouteSchema,
} from './auth.schemas.js';

/** Bundle of the authentication use cases wired from the DI container. */
interface AuthUseCases {
  register: RegisterUserUseCase;
  login: LoginUserUseCase;
  refresh: RefreshTokenUseCase;
  logout: LogoutUseCase;
}

/**
 * Constructs the authentication use cases by resolving their collaborators from
 * the DI container (token service, repositories, audit logger) and pairing them
 * with the bcrypt password hasher.
 *
 * The same {@link BcryptPasswordHasher} instance is shared by registration and
 * login so a password hashed at registration verifies correctly at login.
 */
export function buildAuthUseCases(container: Container): AuthUseCases {
  const users = container.resolve(AUTH_TOKENS.UserRepository);
  const refreshTokens = container.resolve(AUTH_TOKENS.RefreshTokenRepository);
  const tokens = container.resolve(AUTH_TOKENS.TokenService);
  const authEvents = container.resolve(AUTH_TOKENS.AuthEventLogger);
  const hasher = new BcryptPasswordHasher();

  return {
    register: new RegisterUserUseCase(users, hasher),
    login: new LoginUserUseCase(users, refreshTokens, hasher, tokens, authEvents),
    refresh: new RefreshTokenUseCase(users, refreshTokens, tokens, authEvents),
    logout: new LogoutUseCase(refreshTokens, authEvents),
  };
}

/** Options accepted by the {@link authRoutesPlugin}. */
export interface AuthRoutesOptions {
  /** Composition container with the auth infrastructure registered. */
  container: Container;
}

/**
 * Fastify plugin exposing the public authentication endpoints.
 *
 * All four routes are intentionally PUBLIC (no `app.authenticate` preHandler)
 * because they establish or refresh authentication. Inputs are validated with
 * Zod (Requirements 3.6, 25.5); the attached `schema` objects document the
 * routes for OpenAPI (Requirement 3.7). Fastify's built-in schema validation is
 * disabled inside this encapsulated plugin so it never short-circuits the Zod
 * checks — the schemas serve documentation only. Validation failures surface as
 * the consistent 400 envelope with field-level messages (Requirement 25.7).
 * Responses are projected from the safe {@link UserOutput} DTO, which never
 * includes the password hash.
 */
export const authRoutesPlugin: FastifyPluginAsync<AuthRoutesOptions> = (app, opts) => {
  const useCases = buildAuthUseCases(opts.container);

  // Documentation-only schemas: skip Fastify validation so Zod owns input
  // validation and produces the consistent 422 envelope.
  app.setValidatorCompiler(() => (data) => ({ value: data }));

  app.post('/register', { schema: registerRouteSchema }, async (request, reply) => {
    const body = validateBody(request, registerBodySchema);
    const input: RegisterUserInput = {
      tenantId: body.tenantId,
      email: body.email,
      password: body.password,
      firstName: body.firstName,
      lastName: body.lastName,
      roleId: body.roleId,
      ...(body.phone !== undefined ? { phone: body.phone } : {}),
    };
    const user = await useCases.register.execute(input);
    return reply.status(201).send(user);
  });

  app.post('/login', { schema: loginRouteSchema }, async (request, reply) => {
    const body = validateBody(request, loginBodySchema);
    const result = await useCases.login.execute({
      tenantId: body.tenantId,
      email: body.email,
      password: body.password,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    return reply.status(200).send(result);
  });

  app.post('/refresh', { schema: refreshRouteSchema }, async (request, reply) => {
    const body = validateBody(request, refreshBodySchema);
    const result = await useCases.refresh.execute({
      refreshToken: body.refreshToken,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    return reply.status(200).send(result);
  });

  app.post('/logout', { schema: logoutRouteSchema }, async (request, reply) => {
    const body = validateBody(request, logoutBodySchema);
    await useCases.logout.execute({
      refreshToken: body.refreshToken,
      tenantId: body.tenantId ?? null,
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });
    return reply.status(204).send();
  });

  return Promise.resolve();
};

/**
 * Registers the authentication routes under the `/api/v1/auth` prefix.
 *
 * Wraps {@link authRoutesPlugin} in its own encapsulated context so the
 * relaxed validator compiler does not leak to other routes.
 */
export async function registerAuthRoutes(
  app: FastifyInstance,
  container: Container,
): Promise<void> {
  await app.register(authRoutesPlugin, { prefix: '/api/v1/auth', container });
}
