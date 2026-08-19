import type { Prisma } from '@prisma/client';

/**
 * SQL-injection prevention seam for raw queries (task 43.2, Requirement 17.6).
 *
 * The data layer is Prisma. Prisma's query builder (`findMany`, `create`,
 * `where`, ...) is parameterised by design and is NOT an injection vector. The
 * ONLY injection surface is raw SQL, and specifically the `*Unsafe` variants
 * (`$queryRawUnsafe` / `$executeRawUnsafe`) which take a plain string that can
 * be built by concatenating untrusted input.
 *
 * These helpers force every raw query through Prisma's TAGGED-TEMPLATE form
 * (`Prisma.sql`...``), which auto-parameterises interpolated values (`${value}`
 * becomes a bound `$1` placeholder, never inlined text). They accept ONLY a
 * {@link Prisma.Sql} fragment and reject plain strings at runtime, so a caller
 * physically cannot pass a hand-concatenated SQL string through this seam.
 *
 * @see README.md in this folder for the full safe-query pattern guide.
 */

/** Client surface for a parameterised read. Satisfied by the base and tenant clients. */
export interface SafeQueryExecutor {
  $queryRaw<T = unknown>(query: Prisma.Sql): Promise<T>;
}

/** Client surface for a parameterised write. Satisfied by the base and tenant clients. */
export interface SafeExecuteExecutor {
  $executeRaw(query: Prisma.Sql): Promise<number>;
}

/**
 * Thrown when a value that is not a parameterised `Prisma.sql` fragment reaches
 * a safe-raw helper (e.g. a plain string built by concatenation). Surfacing this
 * loudly is the whole point: it means someone bypassed the tagged-template form.
 */
export class UnsafeRawQueryError extends TypeError {
  constructor(method: string) {
    super(
      `${method} requires a parameterised Prisma.sql\`...\` tagged template. ` +
        'Do not pass a plain string or concatenate user input into SQL. Interpolate ' +
        'values as ${value} (auto-parameterised) and compose dynamic fragments with ' +
        'Prisma.join / Prisma.sql.',
    );
    this.name = 'UnsafeRawQueryError';
  }
}

/**
 * Runtime type guard for a Prisma parameterised SQL fragment.
 *
 * `Prisma.Sql` is a type but its runtime constructor is not reliably exported
 * (it is minified in the generated client), so `instanceof` is not usable here.
 * Instead we duck-type the shape produced by `Prisma.sql`/`Prisma.join`: an
 * object carrying a bound-`values` array and a `sql` string of `?` placeholders.
 */
export function isPrismaSql(value: unknown): value is Prisma.Sql {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { values?: unknown; sql?: unknown };
  return Array.isArray(candidate.values) && typeof candidate.sql === 'string';
}

/**
 * Runs a parameterised raw SELECT. The `query` MUST be a `Prisma.sql`...``
 * tagged template (compose dynamic pieces with `Prisma.join`). Values inside the
 * template are always bound, never inlined — so this cannot be SQL-injected.
 *
 * NOTE: table/column *identifiers* cannot be parameterised. If a query needs a
 * dynamic identifier, validate it against a fixed allowlist BEFORE building the
 * fragment (see the folder README).
 */
export function safeQueryRaw<T = unknown>(client: SafeQueryExecutor, query: Prisma.Sql): Promise<T> {
  if (!isPrismaSql(query)) {
    throw new UnsafeRawQueryError('safeQueryRaw');
  }
  // The single sanctioned raw-read seam: the argument is a guaranteed
  // parameterised Prisma.Sql fragment, so this $queryRaw call is safe.
  // eslint-disable-next-line no-restricted-properties
  return client.$queryRaw<T>(query);
}

/**
 * Runs a parameterised raw write (INSERT/UPDATE/DELETE), returning the affected
 * row count. Same guarantees and rules as {@link safeQueryRaw}.
 */
export function safeExecuteRaw(client: SafeExecuteExecutor, query: Prisma.Sql): Promise<number> {
  if (!isPrismaSql(query)) {
    throw new UnsafeRawQueryError('safeExecuteRaw');
  }
  // The single sanctioned raw-write seam: the argument is a guaranteed
  // parameterised Prisma.Sql fragment, so this $executeRaw call is safe.
  // eslint-disable-next-line no-restricted-properties
  return client.$executeRaw(query);
}
