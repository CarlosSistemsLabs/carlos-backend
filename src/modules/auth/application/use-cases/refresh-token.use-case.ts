import { getRequestId } from '@common/context';
import { InvalidRefreshTokenError } from '../../domain/errors/auth-errors.js';
import type { IUserRepository } from '../../domain/repositories/user-repository.js';
import type { IRefreshTokenRepository } from '../../domain/repositories/refresh-token-repository.js';
import type { ITokenService } from '../ports/token-service.js';
import type { IAuthEventLogger } from '../ports/auth-event-logger.js';
import type { RefreshTokenInput, RefreshTokenOutput } from '../dto/auth-dtos.js';

/**
 * Exchanges a valid refresh token for a new access/refresh token pair using a
 * rotation strategy: the presented token is revoked and a new one is issued
 * and persisted (Requirement 8.3).
 *
 * Throws {@link InvalidRefreshTokenError} when the token is unknown, already
 * revoked, expired, or its owning user no longer exists. A successful rotation
 * is recorded via the {@link IAuthEventLogger} port (Requirement 17.7).
 */
export class RefreshTokenUseCase {
  constructor(
    private readonly users: IUserRepository,
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly tokens: ITokenService,
    private readonly authEvents: IAuthEventLogger,
  ) {}

  async execute(input: RefreshTokenInput): Promise<RefreshTokenOutput> {
    const record = await this.refreshTokens.findByToken(input.refreshToken);

    if (record === null || record.isRevoked || record.expiresAt.getTime() <= Date.now()) {
      throw new InvalidRefreshTokenError();
    }

    const user = await this.users.findById(record.userId);
    if (user === null || !user.isActive) {
      throw new InvalidRefreshTokenError();
    }

    // Rotation: revoke the presented token before issuing a replacement.
    await this.refreshTokens.revoke(record.token);

    const accessToken = await this.tokens.issueAccessToken(user);
    const refreshToken = await this.tokens.generateRefreshToken();
    await this.refreshTokens.create({
      userId: user.id,
      token: refreshToken,
      expiresAt: new Date(Date.now() + this.tokens.getRefreshTokenTtlMs()),
    });

    this.authEvents.tokenRefreshed({
      tenantId: user.tenantId,
      userId: user.id,
      email: user.email,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: getRequestId() ?? null,
      timestamp: new Date(),
    });

    return { accessToken, refreshToken };
  }
}
