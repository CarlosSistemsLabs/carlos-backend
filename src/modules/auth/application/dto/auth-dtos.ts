import type { Nullable, UUID } from '@shared/types/index.js';
import type { AuthUser } from '../../domain/entities/auth-user.js';

/** Input for {@link RegisterUserUseCase}. */
export interface RegisterUserInput {
  tenantId: UUID;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  roleId: UUID;
  phone?: Nullable<string>;
}

/** Safe, public projection of a user (never includes the password hash). */
export interface UserOutput {
  id: UUID;
  tenantId: UUID;
  email: string;
  firstName: string;
  lastName: string;
  roleId: UUID;
  phone: Nullable<string>;
  avatar: Nullable<string>;
  isActive: boolean;
  lastLoginAt: Nullable<Date>;
}

/** Optional client metadata captured for authentication audit logging. */
export interface ClientMetadata {
  /** Originating IP address, as resolved by the HTTP layer (task 8.4). */
  ipAddress?: Nullable<string>;
  /** Client `User-Agent`, as resolved by the HTTP layer (task 8.4). */
  userAgent?: Nullable<string>;
}

/** Input for {@link LoginUserUseCase}. */
export interface LoginUserInput extends ClientMetadata {
  tenantId: UUID;
  email: string;
  password: string;
}

/** A pair of access + refresh tokens. */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Result of a successful login. */
export interface LoginUserOutput extends AuthTokens {
  user: UserOutput;
}

/** Input for {@link RefreshTokenUseCase}. */
export interface RefreshTokenInput extends ClientMetadata {
  refreshToken: string;
}

/** Result of a successful token refresh. */
export type RefreshTokenOutput = AuthTokens;

/** Input for {@link LogoutUseCase}. */
export interface LogoutInput extends ClientMetadata {
  refreshToken: string;
  /** Tenant the logout applies to, when known (e.g. from the request context). */
  tenantId?: Nullable<UUID>;
}

/** Maps an {@link AuthUser} aggregate to its safe public projection. */
export function toUserOutput(user: AuthUser): UserOutput {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roleId: user.roleId,
    phone: user.phone,
    avatar: user.avatar,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
  };
}
