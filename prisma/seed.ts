import { disconnectPrisma } from '@infrastructure/database';

/**
 * Database seed entry point.
 *
 * No business data is seeded yet because domain models are defined in later
 * tasks. This placeholder keeps the `db:seed` workflow wired and validates that
 * the Prisma client can be imported and disconnected cleanly.
 */
async function seed(): Promise<void> {
  // Intentionally empty until domain models are introduced.
}

seed()
  .catch((error: unknown) => {
    console.error('Database seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectPrisma();
  });
