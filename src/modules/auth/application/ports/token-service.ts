import type { UUID } from '@shared/types/index.js';
import type { AuthUser } from '../../domain/entities/auth-user.js';

/** Claims encoded in an issued access token. */
export interface AccessTokenClaims {
  /** Subject — the user id. */
  sub: UUID;
  tenantId: UUID;
  roleId: UUID;
  email: string;
}

/**
 * Output port for issuing and verifying authentication tokens.
 *
 * Defined here so the authentication use cases can orchestrate token issuance
 * without depending on a JWT library. The concrete implementation (RS256 JWT
 * access tokens + opaque refresh tokens) is provided by task 8.2; tests stub
 * this port.
 */
export interface ITokenService {
  /** Signs and returns a short-lived access token for the given user. */
  issueAccessToken(user: AuthUser): Promise<string>;

  /** Generates a new opaque refresh token value. */
  generateRefreshToken(): Promise<string>;

  /** Verifies an access token and returns its decoded claims. */
  verifyAccessToken(token: string): Promise<AccessTokenClaims>;

  /** Returns the refresh-token time-to-live in milliseconds. */
  getRefreshTokenTtlMs(): number;
}
