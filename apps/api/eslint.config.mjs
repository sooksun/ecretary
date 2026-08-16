// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'prisma/**', 'assets/**', 'eslint.config.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        // Type-aware linting is deliberately off: it re-typechecks the whole
        // program on every lint run, and `npm run typecheck` already covers
        // type errors. Keep lint fast so it can run on every commit.
        project: false,
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Response: 'readonly',
        AbortController: 'readonly',
      },
    },
    rules: {
      // `constructors`: NestJS DI declares dependencies as ctor params with an
      // empty body. `arrowFunctions`: `.catch(() => {})` is the codebase's
      // deliberate "this failure is not actionable" marker on teardown paths
      // (Redis quit, test cleanup) — flagging it produces noise, not bugs.
      '@typescript-eslint/no-empty-function': [
        'error',
        { allow: ['constructors', 'arrowFunctions'] },
      ],
      // Runtime logging goes through Nest's Logger so it carries context and
      // respects log levels. The one legitimate exception — the bootstrap
      // catch, which runs before the DI container exists — already carries an
      // inline disable, which is what this rule is here to make meaningful.
      'no-console': 'error',
      // `_`-prefixed args are the codebase's existing convention for
      // intentionally-unused parameters (interface conformance, Nest filters).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // The e2e suite runs under Jest and legitimately reaches for `any` when
    // asserting on loosely-typed HTTP response bodies.
    files: ['test/**/*.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
