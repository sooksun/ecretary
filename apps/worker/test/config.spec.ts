/**
 * `config.ts` reads process.env once at module load, so every case has to
 * re-import it through a fresh module registry. Provider selection is the
 * single most consequential env mapping in the worker: pick `mock` by accident
 * and users get template text instead of their meeting.
 */
type Config = typeof import('../src/config').config;

function loadConfig(env: Record<string, string | undefined>): Config {
  let cfg!: Config;
  jest.isolateModules(() => {
    const saved = process.env;
    process.env = { ...saved, ...env } as NodeJS.ProcessEnv;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
    }
    cfg = (require('../src/config') as typeof import('../src/config')).config;
    process.env = saved;
  });
  return cfg;
}

describe('config.llmProvider', () => {
  it('defaults to mock when LLM_PROVIDER is unset', () => {
    expect(loadConfig({ LLM_PROVIDER: undefined }).llmProvider).toBe('mock');
  });

  it.each(['claude', 'openai', 'deepseek', 'ollama', 'openrouter'])(
    'accepts %s',
    (provider) => {
      expect(loadConfig({ LLM_PROVIDER: provider }).llmProvider).toBe(provider);
    },
  );

  it('is case-insensitive', () => {
    expect(loadConfig({ LLM_PROVIDER: 'OpenRouter' }).llmProvider).toBe('openrouter');
  });

  it('falls back to mock — never to a real provider — on an unknown value', () => {
    // Failing closed to `mock` is safe: the worker preflight refuses to boot
    // with mock providers under NODE_ENV=production, so a typo surfaces loudly
    // instead of silently billing the wrong vendor.
    expect(loadConfig({ LLM_PROVIDER: 'clade' }).llmProvider).toBe('mock');
  });
});

describe('config.aiProvider', () => {
  it('defaults to mock', () => {
    expect(loadConfig({ AI_PROVIDER: undefined }).aiProvider).toBe('mock');
  });

  it('accepts whisper', () => {
    expect(loadConfig({ AI_PROVIDER: 'whisper' }).aiProvider).toBe('whisper');
  });

  it('falls back to mock on an unknown value', () => {
    expect(loadConfig({ AI_PROVIDER: 'wisper' }).aiProvider).toBe('mock');
  });
});

describe('config.llmModel defaults per provider', () => {
  it('uses a vendor-prefixed id for OpenRouter', () => {
    // OpenRouter addresses models as `vendor/model`; a bare Anthropic id 404s.
    const model = loadConfig({ LLM_PROVIDER: 'openrouter', LLM_MODEL: undefined }).llmModel;
    expect(model).toContain('/');
  });

  it('uses a bare Anthropic id for claude', () => {
    const model = loadConfig({ LLM_PROVIDER: 'claude', LLM_MODEL: undefined }).llmModel;
    expect(model).not.toContain('/');
    expect(model).toContain('claude');
  });

  it('lets LLM_MODEL override the default for every provider', () => {
    expect(
      loadConfig({ LLM_PROVIDER: 'openrouter', LLM_MODEL: 'google/gemini-2.5-pro' }).llmModel,
    ).toBe('google/gemini-2.5-pro');
  });
});

describe('config.whisperEndpoint', () => {
  it('falls back to a localhost default when unset', () => {
    expect(loadConfig({ WHISPER_ENDPOINT: undefined }).whisperEndpoint).toMatch(/^http/);
  });

  it('uses WHISPER_ENDPOINT when provided', () => {
    expect(loadConfig({ WHISPER_ENDPOINT: 'http://whisper:9001' }).whisperEndpoint).toBe(
      'http://whisper:9001',
    );
  });
});
