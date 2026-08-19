import tls from 'node:tls';
import { afterEach, describe, it, expect } from 'vitest';
import {
  MIN_TLS_VERSION,
  databaseRequiresTls,
  enforceMinimumTlsVersion,
  ensureDatabaseTls,
  isAtLeastTls12,
} from './tls.js';

describe('isAtLeastTls12', () => {
  it('accepts TLSv1.2 and TLSv1.3', () => {
    expect(isAtLeastTls12('TLSv1.2')).toBe(true);
    expect(isAtLeastTls12('TLSv1.3')).toBe(true);
  });

  it('rejects older or unknown versions', () => {
    expect(isAtLeastTls12('TLSv1.1')).toBe(false);
    expect(isAtLeastTls12('TLSv1')).toBe(false);
    expect(isAtLeastTls12(undefined)).toBe(false);
    expect(isAtLeastTls12('')).toBe(false);
  });
});

describe('enforceMinimumTlsVersion', () => {
  const original = tls.DEFAULT_MIN_VERSION;
  afterEach(() => {
    tls.DEFAULT_MIN_VERSION = original;
  });

  it('raises the default when it is below TLSv1.2', () => {
    tls.DEFAULT_MIN_VERSION = 'TLSv1.1';

    const effective = enforceMinimumTlsVersion();

    expect(effective).toBe(MIN_TLS_VERSION);
    expect(tls.DEFAULT_MIN_VERSION).toBe('TLSv1.2');
  });

  it('leaves an already-compliant (or higher) default untouched', () => {
    tls.DEFAULT_MIN_VERSION = 'TLSv1.3';

    const effective = enforceMinimumTlsVersion();

    expect(effective).toBe('TLSv1.3');
    expect(tls.DEFAULT_MIN_VERSION).toBe('TLSv1.3');
  });
});

describe('ensureDatabaseTls', () => {
  it('adds sslmode=require when no sslmode is present', () => {
    const result = ensureDatabaseTls('postgresql://u:p@host:5432/db');
    expect(result).toContain('sslmode=require');
  });

  it('preserves an existing, stronger sslmode', () => {
    const url = 'postgresql://u:p@host:5432/db?sslmode=verify-full';
    expect(ensureDatabaseTls(url)).toBe(url);
  });

  it('returns an unparseable value unchanged', () => {
    expect(ensureDatabaseTls('not a url')).toBe('not a url');
  });
});

describe('databaseRequiresTls', () => {
  it('is true for require / verify-ca / verify-full', () => {
    expect(databaseRequiresTls('postgresql://h/db?sslmode=require')).toBe(true);
    expect(databaseRequiresTls('postgresql://h/db?sslmode=verify-ca')).toBe(true);
    expect(databaseRequiresTls('postgresql://h/db?sslmode=verify-full')).toBe(true);
  });

  it('is false for disable / prefer / missing / unparseable', () => {
    expect(databaseRequiresTls('postgresql://h/db?sslmode=disable')).toBe(false);
    expect(databaseRequiresTls('postgresql://h/db?sslmode=prefer')).toBe(false);
    expect(databaseRequiresTls('postgresql://h/db')).toBe(false);
    expect(databaseRequiresTls('nonsense')).toBe(false);
  });
});
