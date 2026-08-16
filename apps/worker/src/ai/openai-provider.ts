import {
  SummaryOutput,
  SummaryOutputSchema,
  PROMPT_VERSION,
} from '@msec/shared';
import { logger } from '../logger';
import { SummarizationInput, SummarizationProvider } from './summarization';
import {
  SYSTEM_PROMPT_TH,
  RULES_TH,
  TEMPLATE_NOTES,
  pickTemplate,
  renderUserPrompt,
  repairJsonString,
  TOOL_INPUT_SCHEMA,
} from './llm-provider';

export class OpenAISummarizationProvider implements SummarizationProvider {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly providerTag: string;

  constructor(options?: { providerTag?: string }) {
    this.providerTag = options?.providerTag ?? 'openai';
    this.apiKey =
      process.env.OPENAI_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      'dummy';

    let defaultBaseUrl = 'https://api.openai.com/v1';
    if (this.providerTag === 'deepseek') {
      defaultBaseUrl = 'https://api.deepseek.com/v1';
    } else if (this.providerTag === 'ollama') {
      defaultBaseUrl = 'http://localhost:11434/v1';
    } else if (this.providerTag === 'openrouter') {
      defaultBaseUrl = 'https://openrouter.ai/api/v1';
    }

    const rawUrl =
      process.env.OPENAI_BASE_URL ||
      process.env.DEEPSEEK_BASE_URL ||
      process.env.OPENROUTER_BASE_URL ||
      defaultBaseUrl;
    this.baseUrl = rawUrl.replace(/\/+$/, '');
    this.model =
      process.env.LLM_MODEL ||
      process.env.OPENAI_MODEL ||
      (this.providerTag === 'deepseek'
        ? 'deepseek-chat'
        : this.providerTag === 'openrouter'
          ? 'anthropic/claude-sonnet-4.5'
          : 'gpt-4o');
  }

  /**
   * OpenRouter asks callers to identify themselves; the two headers are optional
   * but keep the request attributable on their dashboard. Everything else uses
   * the plain OpenAI shape.
   */
  private extraHeaders(): Record<string, string> {
    if (this.providerTag !== 'openrouter') return {};
    return {
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL ?? 'https://m-secretary.local',
      'X-Title': process.env.OPENROUTER_APP_NAME ?? 'M-Secretary',
    };
  }

  async summarize(input: SummarizationInput) {
    const template = pickTemplate(input.meetingType, input.template);
    const systemPrompt =
      `${SYSTEM_PROMPT_TH}\n\n` +
      `${TEMPLATE_NOTES[template]}\n\n` +
      `${RULES_TH}\n\n` +
      `สำคัญมาก: ตอบกลับเฉพาะข้อความ JSON ที่ตรงตาม JSON Schema ด้านล่างเท่านั้น ` +
      `ห้ามใส่ข้อความเกริ่นหรือบทสรุปอื่นใดนอกเหนือจาก JSON ` +
      `และห้ามเปลี่ยนชื่อ key หรือเพิ่ม/ตัด key ออกจาก schema\n\n` +
      // Anthropic gets this schema through the tool definition; an
      // OpenAI-compatible /chat/completions call has no equivalent channel,
      // so the contract has to travel inside the prompt. Without it the model
      // invents its own key names and every field fails Zod validation.
      `JSON Schema:\n${JSON.stringify(TOOL_INPUT_SCHEMA)}`;

    const userPrompt = renderUserPrompt(input);
    const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 5 * 60 * 1000);

    logger.info(
      {
        meetingId: input.meetingId,
        template,
        provider: this.providerTag,
        model: this.model,
        baseUrl: this.baseUrl,
      },
      'openai.summarize.start',
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders(),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`${this.providerTag} API error ${res.status}: ${errText.slice(0, 300)}`);
    }

    // Only the one field we actually read is typed — the rest of the
    // OpenAI-compatible envelope varies by provider and is not our contract.
    // The real shape check happens below, against SummaryOutputSchema.
    const payload = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error(`${this.providerTag} returned empty completion content`);
    }

    const repaired = repairJsonString(content);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(repaired);
    } catch (err) {
      logger.error(
        { meetingId: input.meetingId, rawContent: content.slice(0, 500) },
        'openai.summarize.jsonParseFailed',
      );
      throw new Error(`Failed to parse JSON response from ${this.providerTag}: ${(err as Error).message}`);
    }

    const safeParsed = SummaryOutputSchema.safeParse(parsedJson);
    if (!safeParsed.success) {
      logger.warn(
        { meetingId: input.meetingId, issues: safeParsed.error.issues.slice(0, 5) },
        'openai.summarize.zodValidationFailed',
      );
      throw new Error(`${this.providerTag} JSON failed Zod validation`);
    }

    return {
      summary: safeParsed.data as SummaryOutput,
      modelName: `${this.providerTag}:${this.model}`,
      promptVersion: `${PROMPT_VERSION}:${template}`,
    };
  }
}
