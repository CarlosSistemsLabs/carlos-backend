import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { UnauthorizedError } from '@domain/errors/index.js';
import type { ITokenService } from '@modules/auth/index.js';
import type { AuthenticatedPayload } from './tenant-context.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Route-level guard that verifies the bearer access token and populates
     * `request.auth`. Attach it to protected routes via their `preHandler`.
     */
    authenticate: preHandlerHookHandler;
  }
}

/** Regular expression extracting the token from an `Authorization` header. */
const BEARER_PATTERN = /^Bearer\s+(.+)$/i;

/**
 * Reads and returns the bearer token from the request's `Authorization`
 * header, or throws {@link UnauthorizedError} when it is absent or malformed.
 */
function extractBearerToken(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (header === undefined || header.length === 0) {
    throw new UnauthorizedError('Authentication required');
  }
  const match = BEARER_PATTERN.exec(header);
  if (match === null || match[1] === undefined || match[1].trim().length === 0) {
    throw new UnauthorizedError('Malformed authorization header');
  }
  return match[1].trim();
}

/**
 * Builds a Fastify `preHandler` that authenticates a request using the bearer
 * access token.
 *
 * It verifies the token via the {@link ITokenService}, then attaches the
 * verified payload to `request.auth` mapping the JWT `sub` claim onto
 * `userId` so the shape matches {@link AuthenticatedPayload} (which the
 * tenant-context hook reads to seed the request context). Any missing, invalid
 * or expired token results in a 401 via {@link UnauthorizedError}, mapped to
 * the consistent error envelope by the central error handler.
 *
 * Routes opt in to authentication by attaching this handler; routes left
 * without it remain public.
 */
export function createAuthenticationPreHandler(
  tokenService: ITokenService,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function authenticate(request: FastifyRequest): Promise<void> {
    const token = extractBearerToken(request);

    let claims;
    try {
      claims = await tokenService.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }

    const payload: AuthenticatedPayload = {
      tenantId: claims.tenantId,
      userId: claims.sub,
      roleId: claims.roleId,
    };
    request.auth = payload;
  };
}

/**
 * Registers the authentication guard as the `authenticate` decorator on the
 * Fastify instance so protected routes can reference it via
 * `{ preHandler: app.authenticate }`.
 */
export function registerAuthentication(app: FastifyInstance, tokenService: ITokenService): void {
  app.decorate('authenticate', createAuthenticationPreHandler(tokenService));
}
