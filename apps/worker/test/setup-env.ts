/**
 * Worker unit tests must never depend on the developer's `.env`. Without this,
 * a machine configured with AI_PROVIDER=whisper makes the transcribe handler
 * reach for S3 and the suite fails for reasons unrelated to the code under
 * test. Pin the providers to their offline implementations and strip any real
 * credentials that happen to be exported in the shell.
 *
 * Tests that care about provider selection (config.spec.ts) set their own
 * values explicitly, so this only establishes the default.
 */
process.env.AI_PROVIDER = 'mock';
process.env.LLM_PROVIDER = 'mock';
process.env.NODE_ENV = 'test';

for (const key of [
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'DEEPSEEK_API_KEY',
  'ALERT_WEBHOOK_URL',
  'LINE_CHANNEL_ACCESS_TOKEN',
]) {
  delete process.env[key];
}
