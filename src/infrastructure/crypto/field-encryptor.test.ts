import { randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  AesGcmFieldEncryptor,
  DEFAULT_KEY_VERSION,
  FieldDecryptionError,
  FIELD_ENCRYPTION_KEY_BYTES,
  NoopFieldEncryptor,
  safeEqual,
} from './field-encryptor.js';

/** Builds an encryptor with a single random key under {@link DEFAULT_KEY_VERSION}. */
function buildEncryptor(keyVersion = DEFAULT_KEY_VERSION): AesGcmFieldEncryptor {
  const keyring = new Map<string, Buffer>([[keyVersion, randomBytes(FIELD_ENCRYPTION_KEY_BYTES)]]);
  return new AesGcmFieldEncryptor({ keyring, activeKeyVersion: keyVersion });
}

describe('AesGcmFieldEncryptor', () => {
  it('round-trips: decrypt(encrypt(x)) === x', () => {
    const encryptor = buildEncryptor();
    const plaintext = 'sk_live_super-secret-token-42';

    const bundle = encryptor.encrypt(plaintext);

    expect(encryptor.decrypt(bundle)).toBe(plaintext);
  });

  it('round-trips unicode and empty strings', () => {
    const encryptor = buildEncryptor();
    for (const plaintext of ['', 'ключ-秘密-🔐', 'a'.repeat(10_000)]) {
      expect(encryptor.decrypt(encryptor.encrypt(plaintext))).toBe(plaintext);
    }
  });

  it('reports isEnabled === true', () => {
    expect(buildEncryptor().isEnabled).toBe(true);
  });

  it('produces DIFFERENT ciphertext for the same plaintext (random IV)', () => {
    const encryptor = buildEncryptor();
    const plaintext = 'repeat-me';

    const first = encryptor.encrypt(plaintext);
    const second = encryptor.encrypt(plaintext);

    expect(first).not.toBe(second);
    // Both still decrypt back to the original.
    expect(encryptor.decrypt(first)).toBe(plaintext);
    expect(encryptor.decrypt(second)).toBe(plaintext);
  });

  it('stamps the scheme and key-version prefix into the bundle', () => {
    const encryptor = buildEncryptor('k7');
    const bundle = encryptor.encrypt('value');

    const segments = bundle.split(':');
    expect(segments).toHaveLength(5);
    expect(segments[0]).toBe('AGCM1');
    expect(segments[1]).toBe('k7');
    // Remaining segments are non-empty base64 (iv, authTag, ciphertext).
    expect(segments[2]!.length).toBeGreaterThan(0);
    expect(segments[3]!.length).toBeGreaterThan(0);
  });

  it('throws a typed error (never the plaintext) when the ciphertext is tampered', () => {
    const encryptor = buildEncryptor();
    const plaintext = 'do-not-leak-me';
    const bundle = encryptor.encrypt(plaintext);

    // Flip a byte inside the ciphertext segment, keeping it valid base64.
    const segments = bundle.split(':');
    const ciphertext = Buffer.from(segments[4]!, 'base64');
    ciphertext[0] = ciphertext[0]! ^ 0xff;
    segments[4] = ciphertext.toString('base64');
    const tampered = segments.join(':');

    try {
      encryptor.decrypt(tampered);
      expect.unreachable('decrypt should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(FieldDecryptionError);
      const decryptionError = error as FieldDecryptionError;
      expect(decryptionError.reason).toBe('authentication_failed');
      // The error must never carry the plaintext.
      expect(decryptionError.message).not.toContain(plaintext);
      expect(JSON.stringify(decryptionError.details ?? {})).not.toContain(plaintext);
    }
  });

  it('throws when the authentication tag is tampered', () => {
    const encryptor = buildEncryptor();
    const bundle = encryptor.encrypt('secret');

    const segments = bundle.split(':');
    const tag = Buffer.from(segments[3]!, 'base64');
    tag[0] = tag[0]! ^ 0x01;
    segments[3] = tag.toString('base64');

    expect(() => encryptor.decrypt(segments.join(':'))).toThrow(FieldDecryptionError);
  });

  it('rejects a malformed bundle (wrong segment count)', () => {
    const encryptor = buildEncryptor();
    try {
      encryptor.decrypt('not-a-valid-bundle');
      expect.unreachable('decrypt should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(FieldDecryptionError);
      expect((error as FieldDecryptionError).reason).toBe('malformed_bundle');
    }
  });

  it('rejects an unsupported scheme', () => {
    const encryptor = buildEncryptor();
    const bundle = encryptor.encrypt('v');
    const segments = bundle.split(':');
    segments[0] = 'AGCM9';

    try {
      encryptor.decrypt(segments.join(':'));
      expect.unreachable('decrypt should have thrown');
    } catch (error) {
      expect((error as FieldDecryptionError).reason).toBe('unsupported_scheme');
    }
  });

  it('rejects a bundle referencing an unknown key version', () => {
    const encryptor = buildEncryptor('k1');
    const bundle = encryptor.encrypt('v');
    const segments = bundle.split(':');
    segments[1] = 'k99';

    try {
      encryptor.decrypt(segments.join(':'));
      expect.unreachable('decrypt should have thrown');
    } catch (error) {
      expect((error as FieldDecryptionError).reason).toBe('unknown_key_version');
    }
  });

  it('fails to decrypt with the WRONG key (different keyring)', () => {
    const encryptor = buildEncryptor('k1');
    const bundle = encryptor.encrypt('secret');

    // A different encryptor with the SAME version label but a different key.
    const wrong = new AesGcmFieldEncryptor({
      keyring: new Map([['k1', randomBytes(FIELD_ENCRYPTION_KEY_BYTES)]]),
      activeKeyVersion: 'k1',
    });

    expect(() => wrong.decrypt(bundle)).toThrow(FieldDecryptionError);
  });

  it('supports rotation: an old key remains in the ring for decryption', () => {
    const oldKey = randomBytes(FIELD_ENCRYPTION_KEY_BYTES);
    const oldEncryptor = new AesGcmFieldEncryptor({
      keyring: new Map([['k1', oldKey]]),
      activeKeyVersion: 'k1',
    });
    const legacyBundle = oldEncryptor.encrypt('legacy-secret');

    // After rotation: k2 is active for writes, k1 kept for reads.
    const rotated = new AesGcmFieldEncryptor({
      keyring: new Map([
        ['k1', oldKey],
        ['k2', randomBytes(FIELD_ENCRYPTION_KEY_BYTES)],
      ]),
      activeKeyVersion: 'k2',
    });

    expect(rotated.decrypt(legacyBundle)).toBe('legacy-secret');
    // New writes use k2.
    expect(rotated.encrypt('x').split(':')[1]).toBe('k2');
  });

  it('throws at construction when the active key is absent from the keyring', () => {
    expect(
      () =>
        new AesGcmFieldEncryptor({
          keyring: new Map([['k1', randomBytes(FIELD_ENCRYPTION_KEY_BYTES)]]),
          activeKeyVersion: 'k2',
        }),
    ).toThrow(/not present in the keyring/);
  });

  it('throws at construction when a key is not 32 bytes', () => {
    expect(
      () =>
        new AesGcmFieldEncryptor({
          keyring: new Map([['k1', randomBytes(16)]]),
          activeKeyVersion: 'k1',
        }),
    ).toThrow(/must be 32 bytes/);
  });
});

describe('NoopFieldEncryptor', () => {
  it('is clearly flagged as disabled', () => {
    expect(new NoopFieldEncryptor().isEnabled).toBe(false);
  });

  it('passes plaintext through unchanged in both directions', () => {
    const noop = new NoopFieldEncryptor();
    expect(noop.encrypt('plain')).toBe('plain');
    expect(noop.decrypt('plain')).toBe('plain');
  });
});

describe('safeEqual', () => {
  it('returns true for equal buffers and false otherwise', () => {
    expect(safeEqual(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
    expect(safeEqual(Buffer.from('abc'), Buffer.from('abd'))).toBe(false);
    expect(safeEqual(Buffer.from('abc'), Buffer.from('abcd'))).toBe(false);
  });
});
