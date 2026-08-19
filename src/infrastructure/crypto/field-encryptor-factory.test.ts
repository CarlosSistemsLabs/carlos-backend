import { randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import type { Environment } from '@config/environment';
import {
  buildFieldEncryptor,
  type FieldEncryptorLogger,
} from './field-encryptor-factory.js';
import { FieldDecryptionError } from './field-encryptor.js';

/** Minimal Environment stub — the factory only reads NODE_ENV + FIELD_ENCRYPTION_KEY. */
function makeEnv(overrides: Partial<Environment>): Environment {
  return { NODE_ENV: 'test', ...overrides } as unknown as Environment;
}

/** Logger that captures emitted lines for assertions (and proves keys never leak). */
function makeCapturingLogger(): {
  logger: FieldEncryptorLogger;
  infos: Array<Record<string, unknown>>;
  warns: Array<Record<string, unknown>>;
} {
  const infos: Array<Record<string, unknown>> = [];
  const warns: Array<Record<string, unknown>> = [];
  return {
    infos,
    warns,
    logger: {
      info: (obj) => infos.push(obj),
      warn: (obj) => warns.push(obj),
    },
  };
}

describe('buildFieldEncryptor', () => {
  it('builds an ENABLED AES encryptor from a hex key', () => {
    const hexKey = randomBytes(32).toString('hex');
    const { logger, infos, warns } = makeCapturingLogger();

    const encryptor = buildFieldEncryptor(makeEnv({ FIELD_ENCRYPTION_KEY: hexKey }), { logger });

    expect(encryptor.isEnabled).toBe(true);
    expect(encryptor.decrypt(encryptor.encrypt('secret'))).toBe('secret');
    expect(warns).toHaveLength(0);
    expect(infos[0]).toMatchObject({ mode: 'enabled', keyVersion: 'k1' });
    // The key material must never be logged.
    expect(JSON.stringify(infos)).not.toContain(hexKey);
  });

  it('builds an ENABLED AES encryptor from a base64 key', () => {
    const base64Key = randomBytes(32).toString('base64');
    const encryptor = buildFieldEncryptor(
      makeEnv({ FIELD_ENCRYPTION_KEY: base64Key }),
      { logger: makeCapturingLogger().logger },
    );

    expect(encryptor.isEnabled).toBe(true);
    expect(encryptor.decrypt(encryptor.encrypt('secret'))).toBe('secret');
  });

  it('honours an explicit version prefix (rotation-ready)', () => {
    const base64Key = randomBytes(32).toString('base64');
    const encryptor = buildFieldEncryptor(
      makeEnv({ FIELD_ENCRYPTION_KEY: `k5:${base64Key}` }),
      { logger: makeCapturingLogger().logger },
    );

    expect(encryptor.encrypt('v').split(':')[1]).toBe('k5');
  });

  it('returns a DISABLED pass-through encryptor with a loud warning when the key is absent', () => {
    const { logger, infos, warns } = makeCapturingLogger();

    const encryptor = buildFieldEncryptor(makeEnv({}), { logger });

    expect(encryptor.isEnabled).toBe(false);
    expect(encryptor.encrypt('plain')).toBe('plain');
    expect(infos).toHaveLength(0);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ mode: 'disabled' });
  });

  it('treats a blank key as absent (disabled)', () => {
    const encryptor = buildFieldEncryptor(
      makeEnv({ FIELD_ENCRYPTION_KEY: '   ' }),
      { logger: makeCapturingLogger().logger },
    );
    expect(encryptor.isEnabled).toBe(false);
  });

  it('FAILS FAST when the configured key is the wrong length', () => {
    const shortKey = randomBytes(16).toString('hex');
    expect(() =>
      buildFieldEncryptor(makeEnv({ FIELD_ENCRYPTION_KEY: shortKey }), {
        logger: makeCapturingLogger().logger,
      }),
    ).toThrow(/32 bytes/);
  });

  it('does not include the key material in the wrong-length error', () => {
    const shortKey = 'a'.repeat(20); // decodes via base64 to a non-32-byte buffer
    try {
      buildFieldEncryptor(makeEnv({ FIELD_ENCRYPTION_KEY: shortKey }), {
        logger: makeCapturingLogger().logger,
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain(shortKey);
    }
  });

  it('produces bundles that fail to decrypt after the key changes (integrity across builds)', () => {
    const encryptorA = buildFieldEncryptor(
      makeEnv({ FIELD_ENCRYPTION_KEY: randomBytes(32).toString('hex') }),
      { logger: makeCapturingLogger().logger },
    );
    const bundle = encryptorA.encrypt('secret');

    const encryptorB = buildFieldEncryptor(
      makeEnv({ FIELD_ENCRYPTION_KEY: randomBytes(32).toString('hex') }),
      { logger: makeCapturingLogger().logger },
    );

    expect(() => encryptorB.decrypt(bundle)).toThrow(FieldDecryptionError);
  });
});
