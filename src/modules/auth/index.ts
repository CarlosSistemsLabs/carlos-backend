/**
 * Public façade for the Authentication module.
 *
 * Other modules and the composition root MUST import auth capabilities through
 * this barrel rather than reaching into the module internals (Module Boundaries
 * in the design). It exposes the use cases, the ports that outer layers wire
 * up, and the safe DTO/error types.
 */

// Use cases (application entry points)
export { RegisterUserUseCase } from './application/use-cases/register-user.use-case.js';
export { LoginUserUseCase } from './application/use-cases/login-user.use-case.js';
export { RefreshTokenUseCase } from './application/use-cases/refresh-token.use-case.js';
export { LogoutUseCase } from './application/use-cases/logout.use-case.js';

// DTO mapper (safe user projection) — consumed by admin user-management (task 27.2)
export { toUserOutput } from './application/dto/auth-dtos.js';

// DTOs
export type {
  RegisterUserInput,
  LoginUserInput,
  LoginUserOutput,
  RefreshTokenInput,
  RefreshTokenOutput,
  LogoutInput,
  UserOutput,
  AuthTokens,
} from './application/dto/auth-dtos.js';

// Ports (implemented by infrastructure / task 8.2)
export type { IPasswordHasher } from './domain/ports/password-hasher.js';
export type { ITokenService, AccessTokenClaims } from './application/ports/token-service.js';
export type {
  IAuthEventLogger,
  AuthEventContext,
  AuthFailureReason,
} from './application/ports/auth-event-logger.js';
export type { IUserRepository } from './domain/repositories/user-repository.js';
export type {
  IRefreshTokenRepository,
  RefreshTokenRecord,
  CreateRefreshTokenInput,
} from './domain/repositories/refresh-token-repository.js';

// Domain entity + value objects
export {
  AuthUser,
  MAX_FAILED_LOGIN_ATTEMPTS,
  ACCOUNT_LOCK_DURATION_MS,
} from './domain/entities/auth-user.js';
export { Email } from './domain/value-objects/email.js';
export { Password } from './domain/value-objects/password.js';

// Errors
export {
  InvalidCredentialsError,
  AccountLockedError,
  AccountInactiveError,
  InvalidRefreshTokenError,
} from './domain/errors/auth-errors.js';

// Infrastructure implementations
export {
  BcryptPasswordHasher,
  DEFAULT_BCRYPT_ROUNDS,
} from './infrastructure/bcrypt-password-hasher.js';
export {
  JwtTokenService,
  InvalidAccessTokenError,
  parseDurationMs,
  type JwtTokenServiceOptions,
  type JwtTokenServicePemOptions,
} from './infrastructure/jwt-token-service.js';
export {
  PrismaUserRepository,
  type UserPrismaClient,
} from './infrastructure/prisma-user-repository.js';
export {
  PrismaRefreshTokenRepository,
  type RefreshTokenPrismaClient,
} from './infrastructure/prisma-refresh-token-repository.js';
export {
  StructuredAuthEventLogger,
  type StructuredLogger,
  type AuthEventName,
} from './infrastructure/structured-auth-event-logger.js';
export { DetectingAuthEventLogger } from './infrastructure/detecting-auth-event-logger.js';

// DTO helper types for client metadata propagation (HTTP layer / task 8.4)
export type { ClientMetadata } from './application/dto/auth-dtos.js';

// Presentation (HTTP routes) — task 8.4
export {
  registerAuthRoutes,
  authRoutesPlugin,
  buildAuthUseCases,
  type AuthRoutesOptions,
} from './presentation/auth.routes.js';
