import { PrismaClient } from '@prisma/client';
import { env } from '@config/environment';
import { buildDatabaseUrl, resolvePoolConfig, resolvePrismaLogLevels } from './prisma-config';

/**
 * Builds a fully configured {@link PrismaClient}.
 *
 * Connection pooling is driven by the database URL (Prisma reads
 * `connection_limit` / `pool_timeout` query parameters), and logging verbosity
 * is selected based on the active runtime environment.
 *
 * The pool is sized from {@link resolvePoolConfig}: `max` (default 20) becomes
 * the `connection_limit` and is the hard ceiling Prisma enforces per instance
 * (Requirement 31.3). `DATABASE_POOL_MIN` (default 5) is advisory only — Prisma
 * has no native pool minimum, so it is NOT encoded into the URL (see
 * {@link buildDatabaseUrl}); it is retained for documentation/observability.
 */
function createPrismaClient(): PrismaClient {
  const pool = resolvePoolConfig(
    env.DATABASE_POOL_MIN,
    env.DATABASE_POOL_SIZE,
    env.DATABASE_POOL_TIMEOUT,
  );
  return new PrismaClient({
    datasources: {
      db: {
        url: buildDatabaseUrl(env.DATABASE_URL, pool.max, pool.timeoutSeconds),
      },
    },
    log: resolvePrismaLogLevels(env.NODE_ENV),
    errorFormat: env.NODE_ENV === 'production' ? 'minimal' : 'pretty',
  });
}

/**
 * Reuse a single client across hot-reloads in non-production environments to
 * avoid exhausting the database connection pool. In production a fresh client
 * is created per process.
 */
const globalForPrisma = globalThis as typeof globalThis & {
  __carlosPrisma?: PrismaClient;
};

export const prisma: PrismaClient = globalForPrisma.__carlosPrisma ?? createPrismaClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.__carlosPrisma = prisma;
}

/** Gracefully closes the Prisma connection pool. */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
