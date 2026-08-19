# Database infrastructure & safe query patterns (task 43.2)

Implements **SQL-injection prevention** for the Carlos ERP backend — Requirement
**17.6** (parameterised queries / no SQL injection). The data layer is
**Prisma + PostgreSQL**.

## TL;DR

1. **Prefer the Prisma query builder.** `findMany`, `findFirst`, `create`,
   `update`, `where`, `aggregate`, `groupBy`, ... are **parameterised by design**
   and are **not** an injection vector. This is >99% of our data access.
2. **Raw SQL is the only injection surface.** If raw is genuinely unavoidable,
   route it through **`safeQueryRaw` / `safeExecuteRaw`** (`safe-query.ts`) with a
   **`Prisma.sql`...`` tagged template**. Interpolated `${value}` becomes a bound
   placeholder — never inlined text.
3. **Never** use `$queryRawUnsafe` / `$executeRawUnsafe`, and never
   string-concatenate input into SQL. ESLint enforces this (see below).

## Why the Prisma builder is safe

Prisma sends the SQL and its arguments to PostgreSQL **separately** (bound
parameters). A value like `"1 OR 1=1"` is treated as a single literal, not as
SQL. So this is safe with any user input:

```ts
await tenantPrisma.product.findMany({
  where: { tenantId, name: { contains: userInput } }, // bound, safe
});
```

## The only injection vector: raw SQL

Two families exist on the Prisma client:

| API | Form | Verdict |
| --- | --- | --- |
| `$queryRaw` / `$executeRaw` | **tagged template** (`` `...${v}...` ``) | Safe — `${v}` is auto-parameterised. **Warned** by ESLint so it is reviewed. |
| `$queryRawUnsafe` / `$executeRawUnsafe` | **plain string** + args | **Forbidden** — a string can be concatenated from input. **Errors** in ESLint. |

### Use the safe helpers

`safe-query.ts` exposes a single audited seam:

```ts
import { Prisma } from '@prisma/client';
import { safeQueryRaw } from '@infrastructure/database/safe-query.js';

const rows = await safeQueryRaw<Row[]>(
  client,
  Prisma.sql`SELECT id, name FROM "Product" WHERE "tenantId" = ${tenantId} AND name ILIKE ${term}`,
);
```

`safeQueryRaw` / `safeExecuteRaw` accept **only** a `Prisma.Sql` fragment and
throw `UnsafeRawQueryError` on a plain string — so a hand-built SQL string
physically cannot pass through.

### Composing dynamic fragments

Optional filters compose with `Prisma.join`, keeping every value bound:

```ts
const conditions: Prisma.Sql[] = [Prisma.sql`s."tenantId" = ${tenantId}`];
if (productId) conditions.push(Prisma.sql`s."productId" = ${productId}`);

const where = Prisma.join(conditions, ' AND ');
await safeQueryRaw(client, Prisma.sql`SELECT * FROM "Stock" s WHERE ${where}`);
```

See `../../modules/stock/infrastructure/prisma-stock-repository.ts`
(`findLowStock`) for the real example — a column-to-column comparison
(`quantity <= product.minStock`) the fluent API cannot express, done safely with
`Prisma.sql`.

### Dynamic identifiers (table/column names)

Identifiers **cannot** be parameterised — only values can. If a query needs a
dynamic column or sort direction, **validate it against a fixed allowlist**
before building the fragment; never interpolate a raw identifier from input:

```ts
const SORTABLE = { name: 'p.name', price: 'p.price' } as const;
const col = SORTABLE[input.sortBy]; // allowlisted; unknown keys rejected upstream
```

### Keep tenant scoping in raw queries

The tenant Prisma extension (`tenant-extension.ts`) only rewrites **model**
operations — it does **not** touch raw SQL. Any raw query against a
tenant-scoped table **must** include an explicit `"tenantId" = ${tenantId}`
predicate (defence-in-depth, Requirement 1.5).

## Enforcement (ESLint)

`eslint.config.js` wires the guardrail:

- **`no-restricted-syntax`** → **error** on any `$queryRawUnsafe` /
  `$executeRawUnsafe` call.
- **`no-restricted-properties`** → **warn** on `$queryRaw` / `$executeRaw` access
  so every raw use is consciously reviewed and moved behind the safe helper.

`npm run lint` therefore fails the build if anyone reaches for an `*Unsafe`
variant. The sanctioned `$queryRaw`/`$executeRaw` calls inside `safe-query.ts`
carry an explicit `eslint-disable` marking them as the single reviewed seam.

## Files

| File | Responsibility |
| --- | --- |
| `prisma-client.ts` | Builds/holds the base `PrismaClient` (pooling, logging). |
| `prisma-config.ts` | Pure pool/log/URL config helpers. |
| `tenant-extension.ts` | `tenantPrisma` (auto tenant scoping) + `systemPrisma` escape hatch. |
| `metrics-extension.ts` | DB query metrics. |
| `safe-query.ts` | `safeQueryRaw` / `safeExecuteRaw` — the only sanctioned raw-SQL seam. |
