import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  safeQueryRaw,
  safeExecuteRaw,
  isPrismaSql,
  UnsafeRawQueryError,
  type SafeQueryExecutor,
  type SafeExecuteExecutor,
} from './safe-query';

describe('isPrismaSql', () => {
  it('recognises a Prisma.sql tagged-template fragment', () => {
    expect(isPrismaSql(Prisma.sql`SELECT ${1}`)).toBe(true);
    expect(isPrismaSql(Prisma.join([Prisma.sql`a = ${1}`, Prisma.sql`b = ${2}`], ' AND '))).toBe(
      true,
    );
  });

  it('rejects plain strings and other non-Sql values', () => {
    expect(isPrismaSql('SELECT 1')).toBe(false);
    expect(isPrismaSql(`SELECT * FROM users WHERE id = ${'1 OR 1=1'}`)).toBe(false);
    expect(isPrismaSql(null)).toBe(false);
    expect(isPrismaSql(undefined)).toBe(false);
    expect(isPrismaSql(42)).toBe(false);
    expect(isPrismaSql({ values: 'not-an-array', sql: 'x' })).toBe(false);
    expect(isPrismaSql({ values: [], sql: 123 })).toBe(false);
  });
});

describe('safeQueryRaw', () => {
  it('accepts a Prisma.sql fragment and delegates to $queryRaw with it', async () => {
    const rows = [{ id: 'p1' }];
    const client: SafeQueryExecutor = { $queryRaw: vi.fn().mockResolvedValue(rows) };
    const productId = "p1'; DROP TABLE users; --";

    const query = Prisma.sql`SELECT id FROM "Product" WHERE id = ${productId}`;
    const result = await safeQueryRaw<Array<{ id: string }>>(client, query);

    expect(result).toBe(rows);
    // The exact Prisma.Sql fragment is forwarded; the malicious value is BOUND,
    // not inlined into the SQL text.
    expect(client.$queryRaw).toHaveBeenCalledWith(query);
    const forwarded = vi.mocked(client.$queryRaw).mock.calls[0]![0] as unknown as {
      sql: string;
      values: unknown[];
    };
    expect(forwarded.sql).not.toContain('DROP TABLE');
    expect(forwarded.values).toEqual([productId]);
  });

  it('rejects a plain string (as designed) without touching the client', () => {
    const client: SafeQueryExecutor = { $queryRaw: vi.fn() };

    expect(() =>
      // Deliberate misuse: a hand-built string must never reach the client.
      safeQueryRaw(client, 'SELECT 1' as unknown as Prisma.Sql),
    ).toThrow(UnsafeRawQueryError);
    expect(client.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects an interpolated plain string built from untrusted input', () => {
    const client: SafeQueryExecutor = { $queryRaw: vi.fn() };
    const evil = "1 OR 1=1; DROP TABLE users; --";

    expect(() =>
      safeQueryRaw(client, `SELECT * FROM users WHERE id = ${evil}` as unknown as Prisma.Sql),
    ).toThrow(UnsafeRawQueryError);
    expect(client.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('safeExecuteRaw', () => {
  it('accepts a Prisma.sql fragment and delegates to $executeRaw with it', async () => {
    const client: SafeExecuteExecutor = { $executeRaw: vi.fn().mockResolvedValue(1) };
    const name = "widget'); DROP TABLE product; --";

    const query = Prisma.sql`UPDATE "Product" SET name = ${name} WHERE id = ${'p1'}`;
    const affected = await safeExecuteRaw(client, query);

    expect(affected).toBe(1);
    expect(client.$executeRaw).toHaveBeenCalledWith(query);
    const forwarded = vi.mocked(client.$executeRaw).mock.calls[0]![0] as unknown as {
      sql: string;
      values: unknown[];
    };
    expect(forwarded.sql).not.toContain('DROP TABLE');
    expect(forwarded.values).toEqual([name, 'p1']);
  });

  it('rejects a plain string (as designed) without touching the client', () => {
    const client: SafeExecuteExecutor = { $executeRaw: vi.fn() };

    expect(() =>
      safeExecuteRaw(client, 'DELETE FROM users' as unknown as Prisma.Sql),
    ).toThrow(UnsafeRawQueryError);
    expect(client.$executeRaw).not.toHaveBeenCalled();
  });
});
