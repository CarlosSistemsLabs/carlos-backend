/**
 * Cryptography infrastructure (task 43.3, Requirements 17.9 & 17.10).
 *
 * Public surface for field-level encryption of reversible secrets at rest and
 * the platform's TLS-in-transit policy helpers. See {@link ./field-encryptor.js}
 * for the password-hashing-vs-encryption distinction and the pass-through
 * fallback rationale.
 */
export {
  AesGcmFieldEncryptor,
  NoopFieldEncryptor,
  FieldDecryptionError,
  DEFAULT_KEY_VERSION,
  FIELD_ENCRYPTION_KEY_BYTES,
  safeEqual,
} from './field-encryptor.js';
export type {
  IFieldEncryptor,
  AesGcmFieldEncryptorOptions,
  FieldDecryptionFailureReason,
} from './field-encryptor.js';

export { buildFieldEncryptor } from './field-encryptor-factory.js';
export type { FieldEncryptorLogger, FieldEncryptorDeps } from './field-encryptor-factory.js';

export {
  MIN_TLS_VERSION,
  enforceMinimumTlsVersion,
  isAtLeastTls12,
  ensureDatabaseTls,
  databaseRequiresTls,
} from './tls.js';
export type { MinTlsVersion } from './tls.js';
