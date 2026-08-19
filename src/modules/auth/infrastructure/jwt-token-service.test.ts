import { describe, it, expect, beforeAll } from 'vitest';
import { SignJWT, generateKeyPair, type CryptoKey } from 'jose';
import { JwtTokenService, InvalidAccessTokenError, parseDurationMs } from './jwt-token-service.js';
import { AuthUser } from '../domain/entities/auth-user.js';

function makeUser(): AuthUser {
  return AuthUser.reconstitute('user-123', {
    tenantId: 'tenant-abc',
    email: 'ada@example.com',
    passwordHash: 'hash',
    firstName: 'Ada',
    lastName: 'Lovelace',
    roleId: 'role-xyz',
    phone: null,
    avatar: null,
    isActive: true,
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
  });
}

describe('parseDurationMs', () => {
  it('parses unit-suffixed durations', () => {
    expect(parseDurationMs('15m')).toBe(15 * 60_000);
    expect(parseDurationMs('900s')).toBe(900_000);
    expect(parseDurationMs('7d')).toBe(7 * 86_400_000);
    expect(parseDurationMs('168h')).toBe(168 * 3_600_000);
  });

  it('treats a bare number as seconds', () => {
    expect(parseDurationMs('60')).toBe(60_000);
  });

  it('throws on an unrecognised format', () => {
    expect(() => parseDurationMs('soon')).toThrow();
    expect(() => parseDurationMs('10x')).toThrow();
  });
});

describe('JwtTokenService', () => {
  let service: JwtTokenService;
  let privateKey: CryptoKey;
  let publicKey: CryptoKey;
  // A second service that shares the keypair with `service` but signs with a
  // different issuer, used to assert issuer enforcement.
  let foreignIssuerService: JwtTokenService;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256', { extractable: false });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;

    service = new JwtTokenService({
      privateKey,
      publicKey,
      accessTtl: '15m',
      refreshTtl: '7d',
      issuer: 'carlos-erp',
    });
    foreignIssuerService = new JwtTokenService({
      privateKey,
      publicKey,
      issuer: 'evil-corp',
    });
  });

  it('issues and verifies an access token, preserving the claims (roundtrip)', async () => {
    const user = makeUser();
    const token = await service.issueAccessToken(user);

    const claims = await service.verifyAccessToken(token);

    expect(claims.sub).toBe('user-123');
    expect(claims.tenantId).toBe('tenant-abc');
    expect(claims.roleId).toBe('role-xyz');
    expect(claims.email).toBe('ada@example.com');
  });

  it('generates opaque, unique refresh tokens', async () => {
    const a = await service.generateRefreshToken();
    const b = await service.generateRefreshToken();

    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
    // base64url alphabet only — no '+', '/', or '=' padding.
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('reports the refresh-token TTL in milliseconds', () => {
    expect(service.getRefreshTokenTtlMs()).toBe(7 * 86_400_000);
  });

  it('rejects a token whose expiry is in the past', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({
      tenantId: 'tenant-abc',
      roleId: 'role-xyz',
      email: 'ada@example.com',
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setSubject('user-123')
      .setIssuer('carlos-erp')
      .setIssuedAt(nowSeconds - 3600)
      .setExpirationTime(nowSeconds - 1800)
      .sign(privateKey);

    await expect(service.verifyAccessToken(expired)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a tampered token', async () => {
    const token = await service.issueAccessToken(makeUser());
    const segments = token.split('.');
    // Deterministically tamper with the signature: decode it to raw bytes,
    // flip every bit of the first byte (XOR 0xff), then re-encode. Mutating
    // the *decoded* buffer guarantees the signature bytes actually change.
    // Editing a single base64url character (the previous approach) was flaky
    // because the trailing bits of a base64url segment are redundant, so some
    // character swaps decode to identical bytes and verification still passed.
    const sigBytes = Buffer.from(segments[2] ?? '', 'base64url');
    sigBytes.writeUInt8(sigBytes.readUInt8(0) ^ 0xff, 0);
    const flipped = sigBytes.toString('base64url');
    const tampered = `${segments[0]}.${segments[1]}.${flipped}`;

    await expect(service.verifyAccessToken(tampered)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('rejects a token signed by a different key', async () => {
    const other = await JwtTokenService.withEphemeralKeys({ issuer: 'carlos-erp' });
    const token = await other.issueAccessToken(makeUser());

    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a token with the wrong issuer', async () => {
    // Signed with issuer "evil-corp" but verified by a service requiring
    // "carlos-erp" — same keypair, so only the issuer differs.
    const token = await foreignIssuerService.issueAccessToken(makeUser());

    await expect(service.verifyAccessToken(token)).rejects.toBeInstanceOf(InvalidAccessTokenError);
  });

  it('rejects a token missing required claims', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const incomplete = await new SignJWT({ tenantId: 'tenant-abc' })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setSubject('user-123')
      .setIssuer('carlos-erp')
      .setIssuedAt(nowSeconds)
      .setExpirationTime(nowSeconds + 900)
      .sign(privateKey);

    await expect(service.verifyAccessToken(incomplete)).rejects.toBeInstanceOf(
      InvalidAccessTokenError,
    );
  });

  it('fromPem builds a working service from exported PEM keys', async () => {
    const { exportPKCS8, exportSPKI } = await import('jose');
    const pair = await generateKeyPair('RS256', { extractable: true });
    const privateKeyPem = await exportPKCS8(pair.privateKey);
    const publicKeyPem = await exportSPKI(pair.publicKey);

    const pemService = await JwtTokenService.fromPem({
      privateKeyPem,
      publicKeyPem,
      issuer: 'carlos-erp',
    });

    const token = await pemService.issueAccessToken(makeUser());
    const claims = await pemService.verifyAccessToken(token);
    expect(claims.sub).toBe('user-123');
  });
});
