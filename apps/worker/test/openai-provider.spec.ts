import { OpenAISummarizationProvider } from '../src/ai/openai-provider';
import type { SummarizationInput } from '../src/ai/summarization';
import { MockSummarizationProvider } from '../src/ai/summarization';

/**
 * The core contract from CLAUDE.md: a real provider must THROW on every failure
 * so BullMQ retries and the meeting ends up FAILED. It must never return
 * partial or substituted content — a meeting marked READY has to reflect the
 * user's actual audio. These tests hold that line without touching the network.
 */

const INPUT: SummarizationInput = {
  meetingId: 'm-1',
  title: 'ประชุมทดสอบ',
  meetingType: 'GENERAL',
  agendaText: null,
  participants: [{ name: 'ครูสมชาย', roleLabel: 'ประธาน' }],
  markers: [],
  transcriptText: 'ที่ประชุมมีมติอนุมัติงบประมาณ',
};

/** A payload that satisfies SummaryOutputSchema, borrowed from the mock provider. */
async function validSummaryJson(): Promise<string> {
  const { summary } = await new MockSummarizationProvider().summarize(INPUT);
  return JSON.stringify(summary);
}

/** Shape of the two fetch args we assert on. */
type FetchInit = { headers: Record<string, string>; body: string };

function mockFetchOnce(impl: () => Promise<unknown>) {
  (globalThis as { fetch: unknown }).fetch = jest.fn(impl);
}

/** A fetch mock that records its (url, init) args in a typed way. */
function recordingFetch(content: string) {
  return jest.fn(async (_url: string, _init: FetchInit) => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  }));
}

const realFetch = globalThis.fetch;

describe('OpenAISummarizationProvider', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.LLM_MODEL = 'gpt-4o';
    delete process.env.OPENAI_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    globalThis.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it('returns the parsed summary when the model replies with valid JSON', async () => {
    const json = await validSummaryJson();
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: json } }] }),
    }));

    const out = await new OpenAISummarizationProvider().summarize(INPUT);
    expect(out.summary.executiveSummary).toBeTruthy();
    expect(out.modelName).toBe('openai:gpt-4o');
    expect(out.promptVersion).toContain('general');
  });

  it('accepts JSON wrapped in a markdown fence (repairJsonString path)', async () => {
    const json = await validSummaryJson();
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '```json\n' + json + '\n```' } }] }),
    }));

    const out = await new OpenAISummarizationProvider().summarize(INPUT);
    expect(out.summary.executiveSummary).toBeTruthy();
  });

  it('throws — never substitutes mock content — on a non-2xx response', async () => {
    mockFetchOnce(async () => ({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }));

    await expect(new OpenAISummarizationProvider().summarize(INPUT)).rejects.toThrow(/429/);
  });

  it('throws when the completion has no content', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: {} }] }),
    }));

    await expect(new OpenAISummarizationProvider().summarize(INPUT)).rejects.toThrow(
      /empty completion/i,
    );
  });

  it('throws when the model returns prose instead of JSON', async () => {
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ขอโทษครับ ผมช่วยไม่ได้' } }] }),
    }));

    await expect(new OpenAISummarizationProvider().summarize(INPUT)).rejects.toThrow(
      /Failed to parse JSON/i,
    );
  });

  it('throws when JSON parses but does not match SummaryOutputSchema', async () => {
    // This is the exact failure that surfaced in production when the schema
    // was never sent to the model: valid JSON, entirely wrong shape.
    mockFetchOnce(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"summary":"wrong shape","topics":[]}' } }],
      }),
    }));

    await expect(new OpenAISummarizationProvider().summarize(INPUT)).rejects.toThrow(
      /Zod validation/i,
    );
  });

  it('sends the JSON Schema in the prompt so the model knows the contract', async () => {
    const fetchMock = recordingFetch(await validSummaryJson());
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    await new OpenAISummarizationProvider().summarize(INPUT);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const system = body.messages.find((m: { role: string }) => m.role === 'system').content;
    expect(system).toContain('JSON Schema');
    expect(system).toContain('executiveSummary');
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('targets OpenRouter with its own base URL and attribution headers', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    delete process.env.OPENAI_API_KEY;
    const fetchMock = recordingFetch(await validSummaryJson());
    (globalThis as { fetch: unknown }).fetch = fetchMock;

    const out = await new OpenAISummarizationProvider({ providerTag: 'openrouter' }).summarize(
      INPUT,
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-or-v1-test');
    expect(init.headers['X-Title']).toBeTruthy();
    expect(out.modelName).toContain('openrouter:');
  });
});
