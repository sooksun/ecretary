/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  // Unit tests only — no DB, no Redis, no network. Anything that needs those
  // belongs in the API e2e suite instead.
  testTimeout: 10_000,
};
