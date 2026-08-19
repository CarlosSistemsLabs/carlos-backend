import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
    // Provide a dummy database URL so modules that construct the Prisma client
    // at import time (e.g. the infrastructure composition root) can load
    // without a live database. Constructing the client does not open a
    // connection, so no real database is required for unit tests.
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/carlos_test',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
