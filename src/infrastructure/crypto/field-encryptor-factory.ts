import type { Environment } from '@config/environment';
import {
  AesGcmFieldEncryptor,
  DEFAULT_KEY_VERSION,
  FIELD_ENCRYPTION_KEY_BYTES,
  NoopFieldEncryptor,
  type IFieldEncryptor,
} from './field-encryptor.js';

/**
 * Wiring for the field-level encryptor (task 43.3, Requirements 17.9 & 17.10).
 *
 * Resolves an {@link IFieldEncryptor} from the environment:
 *
 * - `FIELD_ENCRYPTION_KEY` present → an {@link AesGcmFieldEncryptor} keyed with
 *   the decoded 32-byte key. Encryption is genuinely active.
 * - `FIELD_ENCRYPTION_KEY` absent → a {@link NoopFieldEncryptor} (pass-through,
 *   disabled) plus a LOUD warning. A misconfigured (wrong-length / undecodable)
 *   key FAILS FAST instead: silently disabling encryption because of a typo
 *   would be worse than a clear boot error.
 *
 * Unlike JWT signing — which safely mints an ephemeral keypair in dev/test — a
 * throwaway field key is intentionally NOT generated: it would render any
 * persisted ciphertext unreadable after a restart. Disabling (pass-through) is
 * the correct graceful fallback for encryption at rest, so no sensitive field
 * is wired through the encryptor on a critical path until a real key exists.
 */

/**
 * Minimal structural logger this factory depends on — a subset of pino / the
 * application logger. Kept local so the crypto module does not couple to a
 * feature module's logger type (mirrors the Firebase integration).
 */
export interface FieldEncryptorLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
}

/** Optional test seams for {@link buildFieldEncryptor}. */
export interface FieldEncryptorDeps {
  /** Structured logger for the enabled/disabled boot line (defaults to console). */
  logger?: FieldEncryptorLogger;
}

/**
 * Builds the process-wide {@link IFieldEncryptor}.
 *
 * @param environment - Parsed environment configuration.
 * @param deps - Optional test seams (logger).
 * @throws {Error} when `FIELD_ENCRYPTION_KEY` is set but cannot be decoded to a
 *   {@link FIELD_ENCRYPTION_KEY_BYTES}-byte key (fail-fast on misconfiguration).
 */
export function buildFieldEncryptor(
  environment: Environment,
  deps: FieldEncryptorDeps = {},
): IFieldEncryptor {
  const logger = deps.logger ?? defaultFieldEncryptorLogger;
  const raw = environment.FIELD_ENCRYPTION_KEY?.trim();

  if (raw === undefined || raw === '') {
    // Never log the (absent) key; only the disabled state. In production this is
    // a warning worth surfacing — encryption of reversible secrets is off.
    logger.warn(
      { crypto: 'field-encryption', mode: 'disabled', nodeEnv: environment.NODE_ENV },
      'Field-level encryption DISABLED: FIELD_ENCRYPTION_KEY is not set. Reversible ' +
        'secrets will be stored as-is. Set a 32-byte base64/hex key to enable AES-256-GCM.',
    );
    return new NoopFieldEncryptor();
  }

  const { keyVersion, key } = parseKeyMaterial(raw);
  const keyring = new Map<string, Buffer>([[keyVersion, key]]);
  const encryptor = new AesGcmFieldEncryptor({ keyring, activeKeyVersion: keyVersion });

  // Log only non-sensitive metadata — NEVER the key bytes.
  logger.info(
    { crypto: 'field-encryption', mode: 'enabled', keyVersion },
    'Field-level encryption enabled (AES-256-GCM)',
  );
  return encryptor;
}

/**
 * Parses `FIELD_ENCRYPTION_KEY` into a key version and 32-byte key.
 *
 * Accepted forms (the optional `version:` prefix seeds key rotation — see the
 * rotation notes in the crypto README):
 * - `<base64|hex>` → version defaults to {@link DEFAULT_KEY_VERSION}.
 * - `<version>:<base64|hex>` → explicit version label.
 *
 * The key material is decoded as hex when it is exactly 64 hex characters,
 * otherwise as base64. The decoded key MUST be exactly
 * {@link FIELD_ENCRYPTION_KEY_BYTES} bytes.
 */
function parseKeyMaterial(raw: string): { keyVersion: string; key: Buffer } {
  let keyVersion = DEFAULT_KEY_VERSION;
  let material = raw;

  const separatorIndex = raw.indexOf(':');
  if (separatorIndex > 0) {
    const candidateVersion = raw.slice(0, separatorIndex).trim();
    const candidateMaterial = raw.slice(separatorIndex + 1).trim();
    // Only treat the prefix as a version when it looks like a label (not part of
    // some other encoding) and there is material after it.
    if (/^[A-Za-z0-9_.-]+$/.test(candidateVersion) && candidateMaterial.length > 0) {
      keyVersion = candidateVersion;
      material = candidateMaterial;
    }
  }

  const key = decodeKey(material);
  if (key.length !== FIELD_ENCRYPTION_KEY_BYTES) {
    // Do NOT include the key material in the error.
    throw new Error(
      `FIELD_ENCRYPTION_KEY must decode to exactly ${FIELD_ENCRYPTION_KEY_BYTES} bytes ` +
        `(AES-256); decoded ${key.length} bytes. Provide a 64-char hex or ` +
        `44-char base64 value.`,
    );
  }
  return { keyVersion, key };
}

/** Decodes key material as hex (when 64 hex chars) or otherwise base64. */
function decodeKey(material: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(material)) {
    return Buffer.from(material, 'hex');
  }
  return Buffer.from(material, 'base64');
}

/** Fallback logger used before the application's pino logger is injected. */
const defaultFieldEncryptorLogger: FieldEncryptorLogger = {
  info(obj, msg) {
    // eslint-disable-next-line no-console -- boot-time fallback before pino is injected
    console.info(JSON.stringify({ level: 'info', msg, ...obj }));
  },
  warn(obj, msg) {
    console.warn(JSON.stringify({ level: 'warn', msg, ...obj }));
  },
};
