// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // Off for the same reason as apps/api — `npm run typecheck` owns type
        // errors, lint stays fast enough to run on every commit.
        project: false,
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        Response: 'readonly',
        AbortController: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      // The worker logs through pino (`logger.*`) so that every line is
      // structured and secret-redacted; a bare console.log would bypass
      // redactSecrets() and could leak an API key into the process output.
      'no-console': 'error',
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['constructors', 'arrowFunctions'] },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        jest: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
    rules: {
      // A module that reads `process.env` or resolves `prisma` at import time
      // has to be pulled in with `require` AFTER `jest.mock()` has registered
      // the double — an `import` would be hoisted above the mock and defeat it.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
