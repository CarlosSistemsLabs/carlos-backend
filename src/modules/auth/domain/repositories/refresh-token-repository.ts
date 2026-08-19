import type { UUID } from '@shared/types/index.js';

/** A persisted refresh token record. */
export interface RefreshTokenRecord {
  id: UUID;
  userId: UUID;
  token: string;
  expiresAt: Date;
  isRevoked: boolean;
  createdAt: Date;
}

/** Data required to persist a new refresh token. */
export interface CreateRefreshTokenInput {
  userId: UUID;
  token: string;
  expiresAt: Date;
}

/**
 * Persistence abstraction for refresh tokens, supporting the rotation and
 * revocation strategy (Requirement 8.2, 8.3). The concrete implementation
 * lives in the infrastructure layer.
 */
export interface IRefreshTokenRepository {
  /** Persists a new refresh token and returns the stored record. */
  create(input: CreateRefreshTokenInput): Promise<RefreshTokenRecord>;

  /** Looks up a refresh token by its opaque value, or `null` when unknown. */
  findByToken(token: string): Promise<RefreshTokenRecord | null>;

  /** Marks a single refresh token as revoked (used during rotation/logout). */
  revoke(token: string): Promise<void>;

  /** Revokes every refresh token belonging to a user. */
  revokeAllForUser(userId: UUID): Promise<void>;
}
