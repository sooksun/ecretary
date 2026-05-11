/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.e2e-spec.ts'],
  testTimeout: 30_000,
  maxWorkers: 1,
  setupFiles: ['<rootDir>/test/setup-env.ts'],
};
