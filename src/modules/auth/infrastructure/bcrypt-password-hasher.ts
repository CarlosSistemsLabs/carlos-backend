import bcrypt from 'bcrypt';
import type { IPasswordHasher } from '../domain/ports/password-hasher.js';

/** Minimum bcrypt cost factor mandated by the security policy (Requirement 8.7). */
export const DEFAULT_BCRYPT_ROUNDS = 12;

/**
 * bcrypt-backed implementation of {@link IPasswordHasher}.
 *
 * Uses a cost factor of at least 12 rounds (Requirement 8.7). bcrypt
 * automatically generates and embeds a per-hash salt, so callers only need to
 * provide the plain-text password.
 */
export class BcryptPasswordHasher implements IPasswordHasher {
  private readonly rounds: number;

  /**
   * @param rounds - bcrypt cost factor. Values below
   *   {@link DEFAULT_BCRYPT_ROUNDS} are raised to the minimum to enforce the
   *   security policy.
   */
  constructor(rounds: number = DEFAULT_BCRYPT_ROUNDS) {
    this.rounds = Math.max(rounds, DEFAULT_BCRYPT_ROUNDS);
  }

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.rounds);
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
