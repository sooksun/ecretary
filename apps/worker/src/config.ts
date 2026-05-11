export type AiProvider = 'mock' | 'whisper' | 'openai';
export type LlmProvider = 'mock' | 'claude';

const rawAi = (process.env.AI_PROVIDER ?? 'mock').toLowerCase();
const aiProvider: AiProvider =
  rawAi === 'whisper' || rawAi === 'openai' ? rawAi : 'mock';

const rawLlm = (process.env.LLM_PROVIDER ?? 'mock').toLowerCase();
const llmProvider: LlmProvider = rawLlm === 'claude' ? 'claude' : 'mock';

export const config = {
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
  databaseUrl: process.env.DATABASE_URL,
  aiProvider,
  whisperEndpoint: process.env.WHISPER_ENDPOINT ?? 'http://localhost:9001',
  llmProvider,
  llmModel: process.env.LLM_MODEL ?? 'claude-sonnet-4-6',
  concurrency: {
    transcribe: Number(process.env.WORKER_CONCURRENCY_TRANSCRIBE ?? 2),
    summary: Number(process.env.WORKER_CONCURRENCY_SUMMARY ?? 1),
  },
};
