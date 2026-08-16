// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'ios/**',
      'android/**',
      '.expo/**',
      'dist/**',
      'patches/**',
      // The local Expo module ships its own JS entry; its native sources are
      // linted by Xcode/Gradle, not here.
      'modules/*/build/**',
      'eslint.config.mjs',
      'babel.config.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: false,
        ecmaFeatures: { jsx: true },
      },
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        __DEV__: 'readonly',
        require: 'readonly',
        process: 'readonly',
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The single most valuable rule for this app: a stale dependency array in
      // RecordingScreen/UploadQueue would silently capture an old meeting id
      // mid-recording, which is exactly the class of bug that is hardest to
      // reproduce on a real device.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Release builds keep console output, so a stray log is both noise and a
      // leak risk on a device holding meeting audio. The handful of deliberate
      // `console.warn` diagnostics already carry inline disables — this rule is
      // what stops the next debug `console.log` from shipping alongside them.
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
);
