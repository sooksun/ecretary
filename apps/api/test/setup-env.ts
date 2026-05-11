// Test env hard-overrides — keeps tests deterministic regardless of dev .env.
// IMPORTANT: tests run against a real Postgres + Redis on the host (the same
// ones dev uses). They do NOT reset the database; tests must be idempotent
// and clean up after themselves.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';
// Avoid hitting MinIO / S3 in tests — chunk-upload test uses local driver
process.env.STORAGE_DRIVER = 'local';
// Don't push to LINE during tests
delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
