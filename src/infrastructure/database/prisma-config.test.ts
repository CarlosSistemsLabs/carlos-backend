import { describe, expect, it } from 'vitest';
import { buildDatabaseUrl, resolvePoolConfig, resolvePrismaLogLevels } from './prisma-config';

describe('resolvePrismaLogLevels', () => {
  it('uses quieter logging in production', () => {
    expect(resolvePrismaLogLevels('production')).toEqual(['info', 'warn', 'error']);
  });

  it('includes query logging in development', () => {
    expect(resolvePrismaLogLevels('development')).toEqual(['query', 'info', 'warn', 'error']);
  });

  it('includes query logging in test for verbose debugging', () => {
    expect(resolvePrismaLogLevels('test')).toEqual(['query', 'info', 'warn', 'error']);
  });
});

describe('buildDatabaseUrl', () => {
  it('appends connection pool parameters when missing', () => {
    const result = buildDatabaseUrl('postgresql://user:pass@localhost:5432/db', 10, 15);
    const url = new URL(result);

    expect(url.searchParams.get('connection_limit')).toBe('10');
    expect(url.searchParams.get('pool_timeout')).toBe('15');
  });

  it('preserves existing connection pool parameters', () => {
    const result = buildDatabaseUrl(
      'postgresql://user:pass@localhost:5432/db?connection_limit=5&pool_timeout=3',
      10,
      15,
    );
    const url = new URL(result);

    expect(url.searchParams.get('connection_limit')).toBe('5');
    expect(url.searchParams.get('pool_timeout')).toBe('3');
  });

  it('keeps existing query parameters intact', () => {
    const result = buildDatabaseUrl('postgresql://user:pass@localhost:5432/db?schema=public', 8, 12);
    const url = new URL(result);

    expect(url.searchParams.get('schema')).toBe('public');
    expect(url.searchParams.get('connection_limit')).toBe('8');
  });

  it('returns the original string when the URL cannot be parsed', () => {
    expect(buildDatabaseUrl('not-a-valid-url', 10, 15)).toBe('not-a-valid-url');
  });

  it('does not encode a pool minimum (Prisma has no native min)', () => {
    const url = new URL(buildDatabaseUrl('postgresql://user:pass@localhost:5432/db', 20, 10));
    // Only the max (connection_limit) and timeout are expressible in the URL.
    expect(url.searchParams.get('connection_limit')).toBe('20');
    expect(url.searchParams.get('pool_timeout')).toBe('10');
    expect(url.searchParams.has('connection_min')).toBe(false);
    expect(url.searchParams.has('min')).toBe(false);
  });
});

describe('resolvePoolConfig', () => {
  it('captures the min/max/timeout intent (default 5/20/10)', () => {
    expect(resolvePoolConfig(5, 20, 10)).toEqual({ min: 5, max: 20, timeoutSeconds: 10 });
  });

  it('clamps the advisory min so it never exceeds the hard max', () => {
    expect(resolvePoolConfig(50, 20, 10)).toEqual({ min: 20, max: 20, timeoutSeconds: 10 });
  });

  it('forces a max of at least 1 and floors negative/zero timeouts', () => {
    expect(resolvePoolConfig(5, 0, -3)).toEqual({ min: 1, max: 1, timeoutSeconds: 0 });
  });

  it('floors fractional values to integers', () => {
    expect(resolvePoolConfig(4.9, 20.7, 10.2)).toEqual({ min: 4, max: 20, timeoutSeconds: 10 });
  });
});
