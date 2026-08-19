import { AggregateRoot } from '@domain/entities/aggregate-root.js';
import type { Nullable, UUID } from '@shared/types/index.js';
import type { IPasswordHasher } from '../ports/password-hasher.js';

/** Number of consecutive failed logins before an account is locked. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;

/** Duration, in milliseconds, an account stays locked (15 minutes). */
export const ACCOUNT_LOCK_DURATION_MS = 15 * 60 * 1000;

/** Attributes describing an authenticatable user. */
export interface AuthUserProps {
  tenantId: UUID;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  roleId: UUID;
  phone: Nullable<string>;
  avatar: Nullable<string>;
  isActive: boolean;
  lastLoginAt: Nullable<Date>;
  failedLoginCount: number;
  lockedUntil: Nullable<Date>;
}

/** Input accepted by {@link AuthUser.create} when registering a new user. */
export interface CreateAuthUserInput {
  tenantId: UUID;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  roleId: UUID;
  phone?: Nullable<string>;
  avatar?: Nullable<string>;
}

/**
 * Authentication aggregate root.
 *
 * Encapsulates the behaviour required to authenticate a user and protect the
 * account: password verification (delegated to an {@link IPasswordHasher} port
 * so the domain stays free of bcrypt), lock/unlock, failed-login tracking and
 * successful-login recording. It deliberately knows nothing about JWTs or
 * persistence.
 */
export class AuthUser extends AggregateRoot<AuthUserProps> {
  private constructor(props: AuthUserProps, id?: UUID) {
    super(props, id);
  }

  /** Registers a brand new, active user with no login history. */
  static create(input: CreateAuthUserInput, id?: UUID): AuthUser {
    return new AuthUser(
      {
        tenantId: input.tenantId,
        email: input.email,
        passwordHash: input.passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        roleId: input.roleId,
        phone: input.phone ?? null,
        avatar: input.avatar ?? null,
        isActive: true,
        lastLoginAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
      },
      id,
    );
  }

  /** Rehydrates an {@link AuthUser} from persisted state. */
  static reconstitute(id: UUID, props: AuthUserProps): AuthUser {
    return new AuthUser({ ...props }, id);
  }

  get tenantId(): UUID {
    return this.props.tenantId;
  }

  get email(): string {
    return this.props.email;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get firstName(): string {
    return this.props.firstName;
  }

  get lastName(): string {
    return this.props.lastName;
  }

  get roleId(): UUID {
    return this.props.roleId;
  }

  /**
   * Reassigns the user to a different role (an administrative action performed
   * by a tenant admin, task 27.2). The role's existence within the tenant is
   * validated by the application layer before this is called; the entity only
   * updates the association.
   */
  assignRole(roleId: UUID): void {
    this.props.roleId = roleId;
  }

  get phone(): Nullable<string> {
    return this.props.phone;
  }

  get avatar(): Nullable<string> {
    return this.props.avatar;
  }

  get isActive(): boolean {
    return this.props.isActive;
  }

  get lastLoginAt(): Nullable<Date> {
    return this.props.lastLoginAt;
  }

  get failedLoginCount(): number {
    return this.props.failedLoginCount;
  }

  get lockedUntil(): Nullable<Date> {
    return this.props.lockedUntil;
  }

  /**
   * Verifies a plain-text password against the stored hash via the injected
   * hasher port. Returns `false` rather than throwing on mismatch.
   */
  async validatePassword(plain: string, hasher: IPasswordHasher): Promise<boolean> {
    return hasher.compare(plain, this.props.passwordHash);
  }

  /**
   * Returns `true` when the account is currently locked, i.e. `lockedUntil` is
   * set and still in the future relative to `now`.
   */
  isLocked(now: Date = new Date()): boolean {
    const { lockedUntil } = this.props;
    return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
  }

  /**
   * Locks the account until the given instant. When omitted, the account is
   * locked for {@link ACCOUNT_LOCK_DURATION_MS} from `now`.
   */
  lock(until?: Date, now: Date = new Date()): void {
    this.props.lockedUntil = until ?? new Date(now.getTime() + ACCOUNT_LOCK_DURATION_MS);
  }

  /** Clears any lock and resets the failed-login counter. */
  unlock(): void {
    this.props.lockedUntil = null;
    this.props.failedLoginCount = 0;
  }

  /**
   * Records a failed login attempt by incrementing the counter. The concrete
   * lock-after-threshold policy is wired up in a later task; this method
   * provides the structure and locks once the counter reaches
   * {@link MAX_FAILED_LOGIN_ATTEMPTS}.
   *
   * @returns the new failed-attempt count.
   */
  registerFailedLogin(now: Date = new Date()): number {
    this.props.failedLoginCount += 1;
    if (this.props.failedLoginCount >= MAX_FAILED_LOGIN_ATTEMPTS) {
      this.lock(undefined, now);
    }
    return this.props.failedLoginCount;
  }

  /**
   * Records a successful login: stamps `lastLoginAt`, resets the failed-login
   * counter and clears any lock.
   */
  recordLogin(now: Date = new Date()): void {
    this.props.lastLoginAt = now;
    this.props.failedLoginCount = 0;
    this.props.lockedUntil = null;
  }

  /** Deactivates the account, preventing future authentication. */
  deactivate(): void {
    this.props.isActive = false;
  }
}
