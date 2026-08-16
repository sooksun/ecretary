export type AiProvider = 'mock' | 'whisper' | 'openai';
export type LlmProvider = 'mock' | 'claude' | 'openai' | 'deepseek' | 'ollama' | 'openrouter';

const rawAi = (process.env.AI_PROVIDER ?? 'mock').toLowerCase();
const aiProvider: AiProvider =
  rawAi === 'whisper' || rawAi === 'openai' ? rawAi : 'mock';

const rawLlm = (process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
const llmProvider: LlmProvider =
  rawLlm === 'claude' ||
  rawLlm === 'openai' ||
  rawLlm === 'deepseek' ||
  rawLlm === 'ollama' ||
  rawLlm === 'openrouter'
    ? rawLlm
    : 'mock';

export const config = {
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
  databaseUrl: process.env.DATABASE_URL,
  aiProvider,
  whisperEndpoint: process.env.WHISPER_ENDPOINT ?? 'http://localhost:9001',
  llmProvider,
  llmModel:
    process.env.LLM_MODEL ??
    (llmProvider === 'deepseek'
      ? 'deepseek-chat'
      : llmProvider === 'openai'
        ? 'gpt-4o'
        : llmProvider === 'openrouter'
          ? 'anthropic/claude-sonnet-4.5'
          : 'claude-sonnet-4-6'),
  openaiApiKey:
    process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY || process.env.OPENROUTER_API_KEY,
  openaiBaseUrl:
    process.env.OPENAI_BASE_URL || process.env.DEEPSEEK_BASE_URL || process.env.OPENROUTER_BASE_URL,
  concurrency: {
    transcribe: Number(process.env.WORKER_CONCURRENCY_TRANSCRIBE ?? 2),
    summary: Number(process.env.WORKER_CONCURRENCY_SUMMARY ?? 1),
  },
};

