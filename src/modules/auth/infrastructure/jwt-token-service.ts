import { randomBytes } from 'node:crypto';
import {
  SignJWT,
  jwtVerify,
  importPKCS8,
  importSPKI,
  generateKeyPair,
  errors as joseErrors,
  type CryptoKey,
  type JWTPayload,
} from 'jose';
import type { UUID } from '@shared/types/index.js';
import type { AuthUser } from '../domain/entities/auth-user.js';
import type { AccessTokenClaims, ITokenService } from '../application/ports/token-service.js';

/** JWA algorithm used for access tokens (asymmetric, multi-service verification). */
const JWT_ALGORITHM = 'RS256';

/** Number of random bytes used to build an opaque refresh token (256 bits). */
const REFRESH_TOKEN_BYTES = 32;

/** Default time-to-live values used when none are supplied. */
const DEFAULT_ACCESS_TTL = '15m';
const DEFAULT_REFRESH_TTL = '7d';
const DEFAULT_ISSUER = 'carlos-erp';

/** Multipliers (in milliseconds) for the supported duration units. */
const DURATION_UNIT_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

type DurationUnit = keyof typeof DURATION_UNIT_MS;

/**
 * Parses a human-friendly duration string (e.g. `15m`, `900s`, `7d`, `168h`)
 * into milliseconds. A bare number is interpreted as seconds, mirroring the
 * convention used by common JWT libraries.
 *
 * @throws {Error} when the format is not recognised.
 */
export function parseDurationMs(value: string): number {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1_000;
  }
  const match = /^(\d+)\s*(s|m|h|d)$/.exec(trimmed);
  if (match === null) {
    throw new Error(`Invalid duration string: "${value}"`);
  }
  const amount = Number(match[1]);
  const unit = match[2] as DurationUnit;
  return amount * DURATION_UNIT_MS[unit];
}

/** Construction options for {@link JwtTokenService}. */
export interface JwtTokenServiceOptions {
  /** RS256 private key used to sign access tokens. */
  privateKey: CryptoKey;
  /** RS256 public key used to verify access tokens. */
  publicKey: CryptoKey;
  /** Access-token lifetime (e.g. `15m`). Defaults to 15 minutes. */
  accessTtl?: string;
  /** Refresh-token lifetime (e.g. `7d`). Defaults to 7 days. */
  refreshTtl?: string;
  /** `iss` claim stamped on tokens and required on verification. */
  issuer?: string;
}

/** PEM-based construction options for {@link JwtTokenService.fromPem}. */
export interface JwtTokenServicePemOptions {
  privateKeyPem: string;
  publicKeyPem: string;
  accessTtl?: string;
  refreshTtl?: string;
  issuer?: string;
}

/** Common TTL/issuer subset shared by the factory helpers. */
type TokenServiceConfig = Pick<JwtTokenServiceOptions, 'accessTtl' | 'refreshTtl' | 'issuer'>;

/**
 * RS256 JWT implementation of {@link ITokenService}.
 *
 * Access tokens are signed JWTs carrying the {@link AccessTokenClaims}
 * (`sub`, `tenantId`, `roleId`, `email`) plus the standard `iss`/`iat`/`exp`
 * claims (Requirement 8.1). Refresh tokens are opaque, cryptographically random
 * values; their persistence and rotation are handled by the auth use cases and
 * the refresh-token repository (Requirements 8.2, 8.3).
 */
export class JwtTokenService implements ITokenService {
  private readonly privateKey: CryptoKey;
  private readonly publicKey: CryptoKey;
  private readonly accessTtl: string;
  private readonly refreshTtlMs: number;
  private readonly issuer: string;

  constructor(options: JwtTokenServiceOptions) {
    this.privateKey = options.privateKey;
    this.publicKey = options.publicKey;
    this.accessTtl = options.accessTtl ?? DEFAULT_ACCESS_TTL;
    this.refreshTtlMs = parseDurationMs(options.refreshTtl ?? DEFAULT_REFRESH_TTL);
    this.issuer = options.issuer ?? DEFAULT_ISSUER;
  }

  /**
   * Builds a service from PEM-encoded keys (the format stored in the
   * environment). Imports the keys with the {@link JWT_ALGORITHM} algorithm.
   */
  static async fromPem(options: JwtTokenServicePemOptions): Promise<JwtTokenService> {
    const [privateKey, publicKey] = await Promise.all([
      importPKCS8(options.privateKeyPem, JWT_ALGORITHM),
      importSPKI(options.publicKeyPem, JWT_ALGORITHM),
    ]);
    return new JwtTokenService({
      privateKey,
      publicKey,
      ...JwtTokenService.pickConfig(options),
    });
  }

  /**
   * Builds a service backed by a freshly generated, in-memory RS256 keypair.
   *
   * Intended for local development and tests so the platform runs without
   * provisioning real keys. Tokens signed by an ephemeral keypair are only
   * valid for the lifetime of the process. Never use this in production.
   */
  static async withEphemeralKeys(config: TokenServiceConfig = {}): Promise<JwtTokenService> {
    const { privateKey, publicKey } = await generateKeyPair(JWT_ALGORITHM, {
      extractable: false,
    });
    return new JwtTokenService({ privateKey, publicKey, ...JwtTokenService.pickConfig(config) });
  }

  /** Extracts the optional TTL/issuer config, omitting `undefined` values. */
  private static pickConfig(config: TokenServiceConfig): TokenServiceConfig {
    const picked: TokenServiceConfig = {};
    if (config.accessTtl !== undefined) {
      picked.accessTtl = config.accessTtl;
    }
    if (config.refreshTtl !== undefined) {
      picked.refreshTtl = config.refreshTtl;
    }
    if (config.issuer !== undefined) {
      picked.issuer = config.issuer;
    }
    return picked;
  }

  async issueAccessToken(user: AuthUser): Promise<string> {
    const claims: Omit<AccessTokenClaims, 'sub'> = {
      tenantId: user.tenantId,
      roleId: user.roleId,
      email: user.email,
    };

    return new SignJWT({ ...claims })
      .setProtectedHeader({ alg: JWT_ALGORITHM, typ: 'JWT' })
      .setSubject(user.id)
      .setIssuer(this.issuer)
      .setIssuedAt()
      .setExpirationTime(this.accessTtl)
      .sign(this.privateKey);
  }

  async generateRefreshToken(): Promise<string> {
    return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.publicKey, {
        algorithms: [JWT_ALGORITHM],
        issuer: this.issuer,
      }));
    } catch (error: unknown) {
      throw toTokenError(error);
    }

    return assertClaims(payload);
  }

  getRefreshTokenTtlMs(): number {
    return this.refreshTtlMs;
  }
}

/** Error thrown when an access token fails verification. */
export class InvalidAccessTokenError extends Error {
  constructor(message = 'Access token is invalid or expired') {
    super(message);
    this.name = 'InvalidAccessTokenError';
  }
}

/** Maps a jose verification failure onto an {@link InvalidAccessTokenError}. */
function toTokenError(error: unknown): InvalidAccessTokenError {
  if (error instanceof joseErrors.JWTExpired) {
    return new InvalidAccessTokenError('Access token has expired');
  }
  if (error instanceof joseErrors.JOSEError) {
    return new InvalidAccessTokenError('Access token is invalid');
  }
  return new InvalidAccessTokenError();
}

/** Validates that the decoded payload contains the required string claims. */
function assertClaims(payload: JWTPayload): AccessTokenClaims {
  const { sub, tenantId, roleId, email } = payload;
  if (
    typeof sub !== 'string' ||
    typeof tenantId !== 'string' ||
    typeof roleId !== 'string' ||
    typeof email !== 'string'
  ) {
    throw new InvalidAccessTokenError('Access token is missing required claims');
  }
  return {
    sub: sub as UUID,
    tenantId: tenantId as UUID,
    roleId: roleId as UUID,
    email,
  };
}
