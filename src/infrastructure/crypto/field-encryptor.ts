import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Field-level encryption for sensitive REVERSIBLE secrets at rest
 * (task 43.3, Requirements 17.9 & 17.10).
 *
 * This module encrypts values that must later be read back in clear text —
 * stored third-party API credentials / tokens, plugin integration secrets,
 * service-account material, and other configuration values flagged secret. It
 * is deliberately NOT used for user passwords: those are one-way hashed with
 * bcrypt (see `@modules/auth` {@link import('@modules/auth/index.js')}). Hashing
 * is the correct, irreversible treatment for passwords; ENCRYPTION applies only
 * to secrets the system must recover verbatim. Encrypting a password would be a
 * security regression, so nothing here touches password handling.
 *
 * The cipher is AES-256-GCM (authenticated encryption) from Node's built-in
 * `crypto` — no third-party packages. Each encryption uses a fresh random IV, so
 * encrypting the same plaintext twice yields different ciphertext, and the GCM
 * authentication tag lets {@link IFieldEncryptor.decrypt} detect tampering and
 * refuse to return corrupted/forged data.
 *
 * SECURITY: plaintext values and key material are never logged, embedded in
 * error messages, or thrown. Decryption failures surface a typed
 * {@link FieldDecryptionError} that carries only non-sensitive metadata.
 */

/** Authenticated cipher used for field-level encryption (256-bit key). */
const CIPHER_ALGORITHM = 'aes-256-gcm';

/** Required symmetric key length in bytes for AES-256 (256 bits). */
export const FIELD_ENCRYPTION_KEY_BYTES = 32;

/**
 * IV (nonce) length in bytes. 96 bits is the size recommended by NIST SP
 * 800-38D for AES-GCM: it is the most efficient length and lets GCM use the IV
 * directly without the extra GHASH derivation step wider nonces require.
 */
const IV_BYTES = 12;

/** GCM authentication-tag length in bytes (128 bits — the full, strongest tag). */
const AUTH_TAG_BYTES = 16;

/**
 * Encryption SCHEME identifier stamped as the first segment of every bundle.
 *
 * It versions the on-disk FORMAT (algorithm + layout), independently of the
 * KEY version. Bumping it lets a future scheme (e.g. a different AEAD) be rolled
 * out while old `AGCM1` values remain decryptable.
 */
const SCHEME = 'AGCM1';

/** Delimiter separating the self-describing bundle segments. */
const SEGMENT_SEPARATOR = ':';

/**
 * Default key-version label applied when the environment supplies a bare key
 * with no explicit version. Recorded in each bundle so rotation can introduce
 * new versions without orphaning previously-encrypted data.
 */
export const DEFAULT_KEY_VERSION = 'k1';

/**
 * Port for reversible field-level encryption (Clean Architecture: consumers —
 * repository mapping layers — depend on this abstraction, not a concrete
 * cipher). Implementations are synchronous because Node's symmetric crypto is
 * synchronous and the payloads are small.
 */
export interface IFieldEncryptor {
  /**
   * `true` when a real key is configured and values are genuinely encrypted;
   * `false` for the {@link NoopFieldEncryptor} pass-through (disabled) mode.
   */
  readonly isEnabled: boolean;

  /**
   * Encrypts `plaintext`, returning a self-describing, URL-safe-ish string
   * bundle of the form
   * `SCHEME:keyVersion:base64(iv):base64(authTag):base64(ciphertext)`.
   * A fresh random IV is used on every call.
   */
  encrypt(plaintext: string): string;

  /**
   * Decrypts a bundle produced by {@link encrypt}, verifying the GCM
   * authentication tag first.
   *
   * @throws {FieldDecryptionError} when the bundle is malformed, references an
   *   unknown key version, or fails authentication (tampering / wrong key).
   *   The error never contains the plaintext or key material.
   */
  decrypt(bundle: string): string;
}

/**
 * Typed error raised when a field value cannot be decrypted.
 *
 * Deliberately opaque: it exposes only a stable `reason` code and safe metadata
 * (scheme / key version when parseable) so callers can branch and operators can
 * triage WITHOUT any plaintext, ciphertext, or key material leaking into logs or
 * responses.
 */
export class FieldDecryptionError extends Error {
  /** Machine-readable classification of the failure. */
  public readonly reason: FieldDecryptionFailureReason;

  /** Non-sensitive metadata (e.g. offending scheme / key version), if known. */
  public readonly details?: Readonly<Record<string, string>>;

  constructor(
    reason: FieldDecryptionFailureReason,
    details?: Readonly<Record<string, string>>,
  ) {
    super(`Field decryption failed: ${reason}`);
    this.name = 'FieldDecryptionError';
    this.reason = reason;
    if (details !== undefined) {
      this.details = details;
    }
    Object.setPrototypeOf(this, FieldDecryptionError.prototype);
  }
}

/** Why a decryption attempt failed (safe to log / expose). */
export type FieldDecryptionFailureReason =
  /** The bundle string was empty, mis-segmented, or not valid base64. */
  | 'malformed_bundle'
  /** The bundle's scheme segment is not one this build understands. */
  | 'unsupported_scheme'
  /** No key is configured for the bundle's key-version segment. */
  | 'unknown_key_version'
  /** GCM authentication failed: the data was tampered with or the key is wrong. */
  | 'authentication_failed';

/** Construction options for {@link AesGcmFieldEncryptor}. */
export interface AesGcmFieldEncryptorOptions {
  /**
   * Keyring mapping a key-version label to its 32-byte key. Encryption always
   * uses {@link activeKeyVersion}; decryption selects the key named in the
   * bundle, so retiring a key is a matter of keeping it in the ring (for read)
   * while pointing {@link activeKeyVersion} at the new one (for write). See the
   * rotation notes in `crypto/README` / the factory JSDoc.
   */
  readonly keyring: ReadonlyMap<string, Buffer>;
  /** Key version used to ENCRYPT new values; must exist in {@link keyring}. */
  readonly activeKeyVersion: string;
}

/**
 * AES-256-GCM implementation of {@link IFieldEncryptor} built on Node `crypto`.
 *
 * Bundle layout (all binary segments base64-encoded):
 * `AGCM1:<keyVersion>:<iv>:<authTag>:<ciphertext>`.
 *
 * The leading `SCHEME` and `keyVersion` make each value self-describing, so the
 * decrypt path needs no external metadata and key rotation / scheme upgrades
 * stay backward compatible.
 */
export class AesGcmFieldEncryptor implements IFieldEncryptor {
  public readonly isEnabled = true;

  private readonly keyring: ReadonlyMap<string, Buffer>;
  private readonly activeKeyVersion: string;
  private readonly activeKey: Buffer;

  constructor(options: AesGcmFieldEncryptorOptions) {
    const activeKey = options.keyring.get(options.activeKeyVersion);
    if (activeKey === undefined) {
      throw new Error(
        `Active key version "${options.activeKeyVersion}" is not present in the keyring`,
      );
    }
    for (const [version, key] of options.keyring) {
      if (key.length !== FIELD_ENCRYPTION_KEY_BYTES) {
        throw new Error(
          `Field encryption key "${version}" must be ${FIELD_ENCRYPTION_KEY_BYTES} bytes ` +
            `(got ${key.length})`,
        );
      }
    }
    this.keyring = options.keyring;
    this.activeKeyVersion = options.activeKeyVersion;
    this.activeKey = activeKey;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(CIPHER_ALGORITHM, this.activeKey, iv, {
      authTagLength: AUTH_TAG_BYTES,
    });
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [
      SCHEME,
      this.activeKeyVersion,
      iv.toString('base64'),
      authTag.toString('base64'),
      ciphertext.toString('base64'),
    ].join(SEGMENT_SEPARATOR);
  }

  decrypt(bundle: string): string {
    const parsed = this.parseBundle(bundle);
    const key = this.keyring.get(parsed.keyVersion);
    if (key === undefined) {
      throw new FieldDecryptionError('unknown_key_version', { keyVersion: parsed.keyVersion });
    }

    try {
      const decipher = createDecipheriv(CIPHER_ALGORITHM, key, parsed.iv, {
        authTagLength: AUTH_TAG_BYTES,
      });
      decipher.setAuthTag(parsed.authTag);
      const plaintext = Buffer.concat([decipher.update(parsed.ciphertext), decipher.final()]);
      return plaintext.toString('utf8');
    } catch {
      // GCM tag mismatch (tampering / wrong key) or any decode error. Never
      // rethrow the original — it could carry buffer contents — and never leak
      // the ciphertext/plaintext.
      throw new FieldDecryptionError('authentication_failed', {
        keyVersion: parsed.keyVersion,
      });
    }
  }

  /**
   * Splits and decodes a bundle into its binary parts, validating the scheme
   * and structure. Throws {@link FieldDecryptionError} (never leaking values)
   * on any structural problem.
   */
  private parseBundle(bundle: string): {
    keyVersion: string;
    iv: Buffer;
    authTag: Buffer;
    ciphertext: Buffer;
  } {
    if (typeof bundle !== 'string' || bundle.length === 0) {
      throw new FieldDecryptionError('malformed_bundle');
    }

    const segments = bundle.split(SEGMENT_SEPARATOR);
    if (segments.length !== 5) {
      throw new FieldDecryptionError('malformed_bundle');
    }

    const [scheme, keyVersion, ivB64, authTagB64, ciphertextB64] = segments as [
      string,
      string,
      string,
      string,
      string,
    ];

    if (scheme !== SCHEME) {
      throw new FieldDecryptionError('unsupported_scheme', { scheme });
    }
    if (keyVersion.length === 0) {
      throw new FieldDecryptionError('malformed_bundle');
    }

    const iv = decodeBase64(ivB64);
    const authTag = decodeBase64(authTagB64);
    const ciphertext = decodeBase64(ciphertextB64);
    if (iv === undefined || authTag === undefined || ciphertext === undefined) {
      throw new FieldDecryptionError('malformed_bundle', { keyVersion });
    }
    if (iv.length !== IV_BYTES || authTag.length !== AUTH_TAG_BYTES) {
      throw new FieldDecryptionError('malformed_bundle', { keyVersion });
    }

    return { keyVersion, iv, authTag, ciphertext };
  }
}

/**
 * Pass-through {@link IFieldEncryptor} used when NO key is configured (the
 * disabled mode). {@link isEnabled} is `false`, and both operations return their
 * input unchanged so the application boots and the test suite runs without key
 * material provisioned.
 *
 * This is the correct graceful fallback for encryption AT REST — unlike JWT
 * signing (which safely uses a throwaway ephemeral keypair in dev), a throwaway
 * field key would render any persisted ciphertext permanently unreadable after
 * a restart. Disabling therefore beats faking a key. Callers/operators are
 * warned loudly by {@link import('./field-encryptor-factory.js').buildFieldEncryptor}
 * when this mode is selected.
 */
export class NoopFieldEncryptor implements IFieldEncryptor {
  public readonly isEnabled = false;

  encrypt(plaintext: string): string {
    return plaintext;
  }

  decrypt(bundle: string): string {
    return bundle;
  }
}

/**
 * Decodes base64 into a Buffer, returning `undefined` when the input is not
 * valid, canonical base64. Node's decoder is lenient (it silently drops
 * invalid characters), so we re-encode and compare to reject malformed input —
 * important for treating tampered bundles as {@link FieldDecryptionError}s.
 */
function decodeBase64(value: string): Buffer | undefined {
  // An empty string is valid base64 for a zero-length buffer — legitimate for
  // the ciphertext segment when the plaintext was empty. The IV/tag length
  // checks in the caller reject empty values where they are not allowed.
  const decoded = Buffer.from(value, 'base64');
  // Reject non-canonical / invalid base64: Node's decoder silently drops
  // illegal characters, so require the canonical re-encoding to equal the input
  // exactly (our encoder emits standard, padded base64 that round-trips).
  if (decoded.toString('base64') !== value) {
    return undefined;
  }
  return decoded;
}

/**
 * Constant-time comparison helper re-exported for callers that need to compare
 * secret material (e.g. verifying a decrypted token) without a timing side
 * channel. Returns `false` for length mismatches. Thin wrapper over
 * {@link timingSafeEqual}.
 */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
