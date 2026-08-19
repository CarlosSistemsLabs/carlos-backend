/**
 * Output port for password hashing.
 *
 * Lives in the domain layer so entities and use cases can verify and produce
 * password hashes without depending on a concrete hashing library (bcrypt).
 * The infrastructure layer provides the implementation (dependency inversion,
 * Requirement 3.2).
 */
export interface IPasswordHasher {
  /** Produces a salted hash of the plain-text password. */
  hash(plain: string): Promise<string>;

  /** Returns `true` when `plain` matches the previously produced `hash`. */
  compare(plain: string, hash: string): Promise<boolean>;
}
