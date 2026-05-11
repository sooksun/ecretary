import Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  SummaryOutput,
  SummaryOutputSchema,
  PROMPT_VERSION,
} from '@msec/shared';
import { logger } from '../logger';
import { SummarizationInput, SummarizationProvider } from './summarization';

const SYSTEM_PROMPT_TH =
  'คุณคือเลขานุการประชุมมืออาชีพ มีหน้าที่อ่าน transcript การประชุมภาษาไทย/ไทยปนอังกฤษ ' +
  'แล้วสรุปอย่างเป็นระบบ ห้ามแต่งข้อมูลที่ไม่มีใน transcript หากไม่แน่ใจให้ระบุ confidence ต่ำ ' +
  'และใส่ไว้ใน qualityCheck.\n\n' +
  'ต้องตอบโดยเรียกใช้ tool `submit_meeting_summary` เท่านั้น ห้ามตอบเป็นข้อความปกติ';

const RULES_TH =
  'กติกาในการสรุป:\n' +
  '- อย่าสร้างชื่อผู้รับผิดชอบเองถ้า transcript ไม่ระบุ\n' +
  '- ถ้าไม่พบกำหนดส่ง ให้ dueDate = null\n' +
  '- ทุก decision/action ต้องมี confidence ระหว่าง 0–1\n' +
  '- ถ้าเป็นข้อมูลไม่ชัด ให้เพิ่มใน qualityCheck.uncertainItems\n' +
  '- ถ้าข้อมูลที่ระบบต้องการขาดไป ให้ใส่ใน qualityCheck.missingFields\n' +
  '- officialMinutes ต้องเป็นรูปแบบรายงานการประชุมราชการไทย';

type TemplateKey = 'general' | 'plc' | 'official';

function pickTemplate(meetingType: string, override?: string): TemplateKey {
  if (override === 'official_school_minutes' || override === 'official') return 'official';
  const t = (meetingType || '').toUpperCase();
  if (t === 'PLC') return 'plc';
  return 'general';
}

const TEMPLATE_NOTES: Record<TemplateKey, string> = {
  general:
    'นี่คือการประชุมทั่วไป สรุปให้ครอบคลุมประเด็นหลัก มติ และงานติดตาม',
  plc:
    'นี่คือการประชุม PLC (Professional Learning Community) เน้น:\n' +
    '- ปัญหาการเรียนรู้ของผู้เรียนและหลักฐาน\n' +
    '- วิธีการสอนและแนวทางแก้ไข\n' +
    '- ข้อสะท้อนจากเพื่อนครู\n' +
    '- แผนปรับการสอน\n' +
    '- งานติดตามและหลักฐานที่ต้องเก็บ',
  official:
    'จัดทำสรุปในรูปแบบ "รายงานการประชุมราชการไทย" — ใส่ข้อมูลครบทุกหัวข้อใน officialMinutes ' +
    '(เรื่อง วันเวลาสถานที่ ผู้มาประชุม ผู้ไม่มาประชุม วาระ การอภิปราย มติ เวลาเลิกประชุม ผู้บันทึก ผู้ตรวจ) ' +
    'ถ้าไม่พบใน transcript ให้ใส่ null หรือ [] และระบุใน qualityCheck.missingFields',
};

const TOOL_NAME = 'submit_meeting_summary';

/**
 * Build the JSON Schema for Claude's tool input from our Zod schema.
 * zodToJsonSchema produces a draft-2020-12 schema; Anthropic accepts it as
 * a tool input_schema. The result is cached at module load — prompt caching
 * relies on this byte-stable.
 */
// zod-to-json-schema bundles its own zod typings; @msec/shared exports a
// different zod instance, so the type signatures don't unify. Runtime is
// fine — both speak the same JSON shape — so we cast to bridge the gap.
const TOOL_INPUT_SCHEMA = zodToJsonSchema(SummaryOutputSchema as never, {
  $refStrategy: 'none',
  target: 'jsonSchema7',
});

export class ClaudeSummarizationProvider implements SummarizationProvider {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ClaudeSummarizationProvider requires ANTHROPIC_API_KEY');
    }
    this.client = new Anthropic({ apiKey });
    this.model = process.env.LLM_MODEL ?? 'claude-sonnet-4-6';
  }

  async summarize(input: SummarizationInput) {
    const template = pickTemplate(input.meetingType, input.template);

    const systemBlocks = [
      {
        type: 'text' as const,
        text: SYSTEM_PROMPT_TH,
        cache_control: { type: 'ephemeral' as const },
      },
      {
        type: 'text' as const,
        text: TEMPLATE_NOTES[template] + '\n\n' + RULES_TH,
        cache_control: { type: 'ephemeral' as const },
      },
    ];

    const userText = renderUserPrompt(input);

    logger.info(
      { meetingId: input.meetingId, template, model: this.model },
      'llm.summarize.start',
    );

    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 8000,
      system: systemBlocks,
      tools: [
        {
          name: TOOL_NAME,
          description:
            'ส่งผลสรุปการประชุมในรูปแบบ JSON ตาม schema ของระบบ — ' +
            'เรียก tool นี้เพียงครั้งเดียวเป็น final response',
          input_schema: TOOL_INPUT_SCHEMA as Anthropic.Messages.Tool.InputSchema,
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: userText }],
    });

    logger.info(
      {
        meetingId: input.meetingId,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
        stopReason: res.stop_reason,
      },
      'llm.summarize.usage',
    );

    const toolUse = res.content.find(
      (b): b is Anthropic.Messages.ToolUseBlock =>
        b.type === 'tool_use' && b.name === TOOL_NAME,
    );
    if (!toolUse) {
      // Throw to BullMQ — retry, then on terminal failure the worker's
      // 'failed' handler marks the meeting FAILED. Never silently substitute
      // mock content: the user's transcript MUST be summarized by the
      // configured LLM, or the user must be told.
      throw new Error('Claude returned no tool_use block');
    }

    const parsed = SummaryOutputSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      logger.warn(
        { meetingId: input.meetingId, issues: parsed.error.issues.slice(0, 5) },
        'llm.summarize.invalidJson',
      );
      throw new Error('Claude JSON failed Zod validation');
    }

    return {
      summary: parsed.data as SummaryOutput,
      modelName: `anthropic:${this.model}`,
      promptVersion: `${PROMPT_VERSION}:${template}`,
    };
  }
}

function renderUserPrompt(input: SummarizationInput): string {
  const participants = input.participants.length
    ? input.participants
        .map((p) => (p.roleLabel ? `${p.name} (${p.roleLabel})` : p.name))
        .join(', ')
    : '(ไม่ระบุ)';

  const markers = input.markers.length
    ? input.markers
        .map(
          (m) =>
            `[${m.markerType} @${m.timestampSec}s] ${m.note ?? '(ไม่มีหมายเหตุ)'}`,
        )
        .join('\n')
    : '(ไม่มี marker)';

  return [
    `บริบทการประชุม:`,
    `- ชื่อประชุม: ${input.title}`,
    `- ประเภท: ${input.meetingType}`,
    `- วาระ: ${input.agendaText ?? '(ไม่ระบุ)'}`,
    `- ผู้เข้าร่วม: ${participants}`,
    ``,
    `Markers ที่ผู้บันทึกใส่ระหว่างประชุม:`,
    markers,
    ``,
    `Transcript (ตัวเลขในวงเล็บคือช่วงเวลาวินาที):`,
    input.transcriptText || '(transcript ว่าง)',
    ``,
    `จงเรียก tool ${TOOL_NAME} เพื่อส่งสรุปตาม schema`,
  ].join('\n');
}
