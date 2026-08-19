import { getRequestId, getTenantId, getUserId } from '@common/context';
import type { IRefreshTokenRepository } from '../../domain/repositories/refresh-token-repository.js';
import type { IAuthEventLogger } from '../ports/auth-event-logger.js';
import type { LogoutInput } from '../dto/auth-dtos.js';

/**
 * Logs a user out by revoking the supplied refresh token.
 *
 * Idempotent: revoking an unknown or already-revoked token is a no-op so
 * repeated logout calls succeed without leaking whether the token existed. The
 * logout is recorded via the {@link IAuthEventLogger} port (Requirement 17.7),
 * pulling tenant/user identifiers from the request context when available.
 */
export class LogoutUseCase {
  constructor(
    private readonly refreshTokens: IRefreshTokenRepository,
    private readonly authEvents: IAuthEventLogger,
  ) {}

  async execute(input: LogoutInput): Promise<void> {
    await this.refreshTokens.revoke(input.refreshToken);

    this.authEvents.logout({
      tenantId: input.tenantId ?? getTenantId() ?? null,
      userId: getUserId() ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      requestId: getRequestId() ?? null,
      timestamp: new Date(),
    });
  }
}
