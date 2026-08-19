import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'prisma/**', '*.config.js', '*.config.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      // SQL-injection prevention guardrail (task 43.2, Requirement 17.6).
      // Prisma's query builder is parameterised and safe; the ONLY injection
      // surface is raw SQL. The `*Unsafe` variants take a plain string and are
      // FORBIDDEN (error) — use `safeQueryRaw`/`safeExecuteRaw`
      // (src/infrastructure/database/safe-query.ts) with a `Prisma.sql`...``
      // tagged template. The tagged-template `$queryRaw`/`$executeRaw` are
      // WARNED so any remaining raw usage is consciously reviewed and routed
      // through the safe helper.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='$queryRawUnsafe'], CallExpression[callee.property.name='$executeRawUnsafe']",
          message:
            'Do not use $queryRawUnsafe/$executeRawUnsafe — they take a plain string and are SQL-injection prone. Use safeQueryRaw/safeExecuteRaw with a Prisma.sql`...` tagged template (auto-parameterised). See src/infrastructure/database/README.md.',
        },
      ],
      'no-restricted-properties': [
        'warn',
        {
          property: '$queryRaw',
          message:
            'Raw SQL detected: prefer the Prisma query builder. If raw is unavoidable, route it through safeQueryRaw with a Prisma.sql`...` tagged template (never string-concatenate input). See src/infrastructure/database/README.md.',
        },
        {
          property: '$executeRaw',
          message:
            'Raw SQL detected: prefer the Prisma query builder. If raw is unavoidable, route it through safeExecuteRaw with a Prisma.sql`...` tagged template (never string-concatenate input). See src/infrastructure/database/README.md.',
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettierConfig,
);
