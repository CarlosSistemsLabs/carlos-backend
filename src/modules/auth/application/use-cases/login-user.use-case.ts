import { getRequestId } from '@common/context';
import { Email } from '../../domain/value-objects/email.js';
import {
  AccountInactiveError,
  AccountLockedError,
  InvalidCredentialsError,
} from '../../domain/errors/auth-errors.js';
import type { IPasswordHasher } from '../../domain/ports/password-hasher.js';
import type { IUserRepository } from '../../domain/repositories/user-repository.js';
import type { IRefreshTokenRepository } from '../../domain/repositories/refresh-token-repository.js';
import type { ITokenService } from '../ports/token-service.js';
import type { AuthEventContext, IAuthEventLogger } from '../ports/auth-event-logger.js';
import { toUserOutput, type LoginUserInput, type LoginUserOutput } from '../dto/auth-dtos.js';

/**
 * Authenticates a user with email + password and issues an access/refresh
 * token pair.
 *
 * On bad credentials it records a failed-login attempt (which may lock the
 * account after {@link MAX_FAILED_LOGIN_ATTEMPTS} consecutive failures for
 * {@link ACCOUNT_LOCK_DURATION_MS}) and throws {@link InvalidCredentialsError}.
 * On success it records the login, persists a rotated refresh token and returns
 * tokens plus the safe user projection. Token issuance is delegated to the
 * {@link ITokenService} port.
 *
 * Every attempt — success or failure — is recorded via the
 * {@link IAuthEventLogger} port (Requirement 17.7). Failure events capture the
 * reason (invalid credentials, locked, inactive) for operators while the thrown
 * error stays generic so the API never reveals whether an email exists.
 */
export class LoginUserUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly hasher: IPasswordHasher,
    private readonly tokens: ITokenService,
    private readonly authEvents: IAuthEventLogger,
  ) {}

  async execute(input: LoginUserInput): Promise<LoginUserOutput> {
    const email = Email.create(input.email);
    const ctx = this.baseContext(input);

    const user = await this.users.findByEmail(input.tenantId, email.value);
    if (user === null) {
      this.authEvents.loginFailed(ctx, 'user_not_found');
      throw new InvalidCredentialsError();
    }

    const userCtx: AuthEventContext = { ...ctx, userId: user.id };

    if (user.isLocked()) {
      this.authEvents.loginFailed(userCtx, 'account_locked');
      throw new AccountLockedError(user.lockedUntil ?? undefined);
    }

    if (!user.isActive) {
      this.authEvents.loginFailed(userCtx, 'account_inactive');
      throw new AccountInactiveError();
    }

    const passwordMatches = await user.validatePassword(input.password, this.hasher);
    if (!passwordMatches) {
      user.registerFailedLogin();
      await this.users.update(user);

      this.authEvents.loginFailed(userCtx, 'invalid_credentials');

      if (user.isLocked()) {
        // The failed attempt just crossed the threshold and locked the account.
        this.authEvents.accountLocked(userCtx);
        throw new AccountLockedError(user.lockedUntil ?? undefined);
      }
      throw new InvalidCredentialsError();
    }

    user.recordLogin();
    await this.users.update(user);

    const accessToken = await this.tokens.issueAccessToken(user);
    const refreshToken = await this.tokens.generateRefreshToken();
    await this.refreshTokens.create({
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + this.tokens.getRefreshTokenTtlMs()),
    });

    this.authEvents.loginSucceeded(userCtx);

    return {
      user: toUserOutput(user),
      accessToken,
      refreshToken,
    };
  }

  /** Builds the audit context shared by every outcome of this attempt. */
  private baseContext(input: LoginUserInput): AuthEventContext {
    return {
      tenantId: input.tenantId,
      email: input.email,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: getRequestId() ?? null,
      timestamp: new Date(),
    };
  }
}
