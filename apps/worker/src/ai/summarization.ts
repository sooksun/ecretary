import { SummaryOutput, SummaryOutputSchema, MOCK_MODEL_NAME, PROMPT_VERSION } from '@msec/shared';

/**
 * Summary provider interface.
 *
 * Phase A: deterministic mock that always returns a valid SummaryOutput.
 * Phase 4: real LLM impl will produce JSON, validate via Zod, and fall
 * back here on parse failure.
 */
export interface SummarizationInput {
  meetingId: string;
  title: string;
  meetingType: string;
  agendaText?: string | null;
  participants: { name: string; roleLabel?: string | null }[];
  markers: { markerType: string; timestampSec: number; note?: string | null }[];
  transcriptText: string;
  /** When set, instructs the provider to use a specific template (e.g. official_school_minutes). */
  template?: string;
}

export interface SummarizationProvider {
  summarize(input: SummarizationInput): Promise<{ summary: SummaryOutput; modelName: string; promptVersion: string }>;
}

export class MockSummarizationProvider implements SummarizationProvider {
  async summarize(input: SummarizationInput) {
    const decisionMarkers = input.markers.filter((m) => m.markerType === 'DECISION');
    const actionMarkers = input.markers.filter((m) => m.markerType === 'ACTION');

    const summary: SummaryOutput = {
      executiveSummary: `สรุปการประชุม "${input.title}" — ${input.participants.length} ผู้เข้าร่วม` +
        (input.agendaText ? ` วาระ: ${input.agendaText.slice(0, 80)}` : ''),
      keyPoints: [
        {
          title: 'ประเด็นหลักของวาระ',
          detail: input.agendaText
            ? input.agendaText.slice(0, 200)
            : 'ที่ประชุมหารือประเด็นหลักตามวาระที่กำหนด',
          confidence: 0.7,
          sourceTimestampSec: 0,
        },
        {
          title: 'ความก้าวหน้าและประเด็นติดตาม',
          detail: 'มีการนำเสนอความก้าวหน้าและกำหนดผู้รับผิดชอบติดตามงาน',
          confidence: 0.65,
          sourceTimestampSec: 120,
        },
      ],
      decisions: decisionMarkers.length
        ? decisionMarkers.map((m, i) => ({
            decision: m.note ?? `มติที่ ${i + 1}`,
            rationale: 'ตาม marker ที่บันทึกระหว่างประชุม',
            confidence: 0.8,
            sourceTimestampSec: m.timestampSec,
          }))
        : [
            {
              decision: 'เห็นชอบดำเนินการตามแผน',
              rationale: 'ที่ประชุมให้ความเห็นชอบในเบื้องต้น',
              confidence: 0.55,
              sourceTimestampSec: null,
            },
          ],
      actionItems: actionMarkers.length
        ? actionMarkers.map((m) => ({
            title: m.note ?? 'งานติดตาม',
            description: 'งานที่ได้รับมอบหมายระหว่างการประชุม',
            assigneeName: input.participants[0]?.name ?? null,
            dueDate: null,
            evidenceRequired: 'รายงานความคืบหน้าในที่ประชุมครั้งถัดไป',
            confidence: 0.7,
            sourceTimestampSec: m.timestampSec,
          }))
        : [
            {
              title: 'จัดทำสรุปและส่งให้ผู้เกี่ยวข้อง',
              description: 'ส่งสรุปการประชุมและงานติดตามภายใน 3 วันทำการ',
              assigneeName: input.participants[0]?.name ?? null,
              dueDate: null,
              evidenceRequired: null,
              confidence: 0.6,
              sourceTimestampSec: null,
            },
          ],
      risks: [
        {
          risk: 'การติดตามอาจคลาดเคลื่อนหากไม่กำหนดผู้รับผิดชอบชัดเจน',
          impact: 'งานล่าช้า',
          recommendation: 'ระบุผู้รับผิดชอบและกำหนดวันส่งทุกงาน',
          confidence: 0.6,
        },
      ],
      pendingQuestions: [
        {
          question: 'ใครรับผิดชอบประเมินผลโดยรวม?',
          owner: null,
          confidence: 0.55,
        },
      ],
      officialMinutes: {
        title: input.title,
        dateText: new Date().toLocaleDateString('th-TH'),
        location: null,
        attendees: input.participants.map((p) =>
          p.roleLabel ? `${p.name} (${p.roleLabel})` : p.name,
        ),
        absentees: [],
        agendaItems: [
          {
            agendaNo: '1',
            topic: 'ประธานแจ้งให้ที่ประชุมทราบ',
            discussion: 'ประธานเปิดประชุมและแจ้งข้อมูลทั่วไป',
            resolution: null,
          },
          {
            agendaNo: '2',
            topic: 'รับรองรายงานการประชุมครั้งที่แล้ว',
            discussion: '—',
            resolution: 'รับรอง',
          },
          {
            agendaNo: '3',
            topic: 'เรื่องสืบเนื่อง',
            discussion: 'ติดตามงานจากการประชุมครั้งที่แล้ว',
            resolution: null,
          },
          {
            agendaNo: '4',
            topic: 'เรื่องเพื่อพิจารณา',
            discussion: input.agendaText ?? '—',
            resolution: 'เห็นชอบให้ดำเนินการตามที่นำเสนอ',
          },
          {
            agendaNo: '5',
            topic: 'เรื่องอื่น ๆ',
            discussion: '—',
            resolution: null,
          },
        ],
        closedAt: null,
        minuteTaker: null,
        reviewer: null,
      },
      qualityCheck: {
        missingFields: input.participants.length === 0 ? ['attendees'] : [],
        uncertainItems: ['assignee not explicitly named in some action items'],
        recommendations: ['ผู้รับผิดชอบควรตรวจทานสรุปก่อนใช้เป็นเอกสารทางราชการ'],
      },
    };

    // self-validate so the rest of the pipeline can trust the shape
    SummaryOutputSchema.parse(summary);

    return {
      summary,
      modelName: MOCK_MODEL_NAME,
      promptVersion: PROMPT_VERSION,
    };
  }
}
