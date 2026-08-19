import { describe, it, expect } from 'vitest';
import { BcryptPasswordHasher, DEFAULT_BCRYPT_ROUNDS } from './bcrypt-password-hasher.js';

describe('BcryptPasswordHasher', () => {
  const hasher = new BcryptPasswordHasher();

  it('produces a bcrypt hash that differs from the plain text', async () => {
    const hash = await hasher.hash('S3cretPass');
    expect(hash).not.toBe('S3cretPass');
    // bcrypt hashes are 60 chars and encode the cost factor in the prefix.
    expect(hash).toHaveLength(60);
    expect(hash.startsWith(`$2b$${DEFAULT_BCRYPT_ROUNDS}$`)).toBe(true);
  });

  it('compares a matching password as true', async () => {
    const hash = await hasher.hash('S3cretPass');
    await expect(hasher.compare('S3cretPass', hash)).resolves.toBe(true);
  });

  it('compares a non-matching password as false', async () => {
    const hash = await hasher.hash('S3cretPass');
    await expect(hasher.compare('WrongPass1', hash)).resolves.toBe(false);
  });

  it('produces different hashes for the same input (random salt)', async () => {
    const [a, b] = await Promise.all([hasher.hash('S3cretPass'), hasher.hash('S3cretPass')]);
    expect(a).not.toBe(b);
  });

  it('enforces the minimum cost factor even when a lower value is requested', async () => {
    const weak = new BcryptPasswordHasher(4);
    const hash = await weak.hash('S3cretPass');
    expect(hash.startsWith(`$2b$${DEFAULT_BCRYPT_ROUNDS}$`)).toBe(true);
  });
});
