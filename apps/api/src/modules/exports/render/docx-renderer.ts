import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  Footer,
  PageNumber,
  Table,
  TableCell,
  TableRow,
  WidthType,
} from 'docx';
import type { OfficialMinutes, SummaryOutput } from '@msec/shared';

const FONT_FAMILY = 'TH Sarabun New'; // most Thai gov templates expect this

interface RenderInput {
  meetingTitle: string;
  meetingType: string;
  organizationName?: string | null;
  summary: SummaryOutput;
}

export async function renderMinutesDocx(input: RenderInput): Promise<Buffer> {
  const m = input.summary.officialMinutes;

  const doc = new Document({
    creator: 'M-Secretary',
    title: m.title,
    description: 'รายงานการประชุม',
    styles: {
      default: {
        document: {
          run: { font: FONT_FAMILY, size: 32 /* 16pt */ },
        },
      },
    },
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        footers: {
          default: new Footer({
            children: [
              p({
                alignment: AlignmentType.CENTER,
                runs: [
                  txt('หน้า '),
                  new TextRun({ children: [PageNumber.CURRENT], font: FONT_FAMILY }),
                  txt(' / '),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT_FAMILY }),
                ],
              }),
            ],
          }),
        },
        children: [
          // Header
          input.organizationName
            ? p({ alignment: AlignmentType.CENTER, runs: [txtBold(input.organizationName)] })
            : p({ alignment: AlignmentType.CENTER, runs: [txtBold('รายงานการประชุม')] }),
          p({
            alignment: AlignmentType.CENTER,
            heading: HeadingLevel.HEADING_1,
            runs: [txtBold(m.title)],
          }),
          p({ alignment: AlignmentType.CENTER, runs: [txt(m.dateText)] }),
          m.location ? p({ alignment: AlignmentType.CENTER, runs: [txt(`สถานที่: ${m.location}`)] }) : empty(),
          empty(),

          // Attendees
          sectionHeader('ผู้มาประชุม'),
          ...numberedList(m.attendees, 'ไม่มีรายชื่อผู้เข้าประชุม'),
          empty(),

          // Absentees
          sectionHeader('ผู้ไม่มาประชุม'),
          ...numberedList(m.absentees, '— ไม่มี —'),
          empty(),

          // Participants (observers)
          ...(m.participants && m.participants.length > 0
            ? [sectionHeader('ผู้เข้าร่วมประชุม'), ...numberedList(m.participants, '')]
            : []),
          ...(m.participants && m.participants.length > 0 ? [empty()] : []),

          // Agenda
          sectionHeader('ระเบียบวาระการประชุม'),
          ...m.agendaItems.flatMap((item) => agendaBlock(item)),
          empty(),

          // Action items table
          ...renderActionItemsTable(input.summary),

          // Closed
          ...(m.closedAt ? [sectionHeader('เลิกประชุม'), p({ runs: [txt(m.closedAt)] }), empty()] : []),

          // Signers
          ...renderSignerTable(m),

          // Quality footer
          ...renderQualityNote(input.summary),
        ],
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ── helpers ────────────────────────────────────────────────────────────

function txt(text: string) {
  return new TextRun({ text, font: FONT_FAMILY });
}

function txtBold(text: string) {
  return new TextRun({ text, font: FONT_FAMILY, bold: true });
}

function p(opts: {
  runs: TextRun[];
  alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
  heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel];
}) {
  return new Paragraph({
    children: opts.runs,
    alignment: opts.alignment,
    heading: opts.heading,
  });
}

function empty() {
  return new Paragraph({ children: [] });
}

function sectionHeader(label: string) {
  return p({
    runs: [txtBold(label)],
    heading: HeadingLevel.HEADING_2,
  });
}

function numberedList(items: string[], emptyLabel: string) {
  if (!items.length) return [p({ runs: [txt(emptyLabel)] })];
  return items.map((line, i) => p({ runs: [txt(`${i + 1}. ${line}`)] }));
}

function agendaBlock(item: { agendaNo: string; topic: string; discussion: string; resolution?: string | null }) {
  const blocks = [
    p({ runs: [txtBold(`วาระที่ ${item.agendaNo}: ${item.topic}`)] }),
    p({ runs: [txt(`การอภิปราย: ${item.discussion}`)] }),
  ];
  if (item.resolution) {
    blocks.push(p({ runs: [txtBold('มติที่ประชุม: '), txt(item.resolution)] }));
  }
  blocks.push(empty());
  return blocks;
}

function renderActionItemsTable(summary: SummaryOutput) {
  if (!summary.actionItems.length) return [];
  const header = new TableRow({
    children: ['งาน', 'ผู้รับผิดชอบ', 'กำหนดส่ง', 'หลักฐาน'].map(
      (h) =>
        new TableCell({
          children: [p({ runs: [txtBold(h)] })],
          width: { size: 25, type: WidthType.PERCENTAGE },
        }),
    ),
  });
  const rows = summary.actionItems.map(
    (a) =>
      new TableRow({
        children: [
          new TableCell({ children: [p({ runs: [txt(a.title)] })] }),
          new TableCell({ children: [p({ runs: [txt(a.assigneeName ?? '—')] })] }),
          new TableCell({ children: [p({ runs: [txt(a.dueDate ?? '—')] })] }),
          new TableCell({ children: [p({ runs: [txt(a.evidenceRequired ?? '—')] })] }),
        ],
      }),
  );
  return [
    sectionHeader('งานที่มอบหมาย'),
    new Table({
      rows: [header, ...rows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
    empty(),
  ];
}

function renderSignerTable(m: OfficialMinutes) {
  return [
    new Table({
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [
                p({ alignment: AlignmentType.CENTER, runs: [txt('(ลงชื่อ) ............................................')] }),
                p({ alignment: AlignmentType.CENTER, runs: [txt(`(${m.minuteTaker ?? '...........................'})`)] }),
                p({ alignment: AlignmentType.CENTER, runs: [txt('ผู้บันทึกรายงานการประชุม')] }),
              ],
            }),
            new TableCell({
              children: [
                p({ alignment: AlignmentType.CENTER, runs: [txt('(ลงชื่อ) ............................................')] }),
                p({ alignment: AlignmentType.CENTER, runs: [txt(`(${m.reviewer ?? '...........................'})`)] }),
                p({ alignment: AlignmentType.CENTER, runs: [txt('ผู้ตรวจรายงานการประชุม')] }),
              ],
            }),
          ],
        }),
      ],
      width: { size: 100, type: WidthType.PERCENTAGE },
    }),
  ];
}

function renderQualityNote(summary: SummaryOutput) {
  const q = summary.qualityCheck;
  if (!q.missingFields.length && !q.uncertainItems.length) return [];
  const lines: Paragraph[] = [empty(), sectionHeader('หมายเหตุการตรวจสอบ (AI quality check)')];
  if (q.missingFields.length) {
    lines.push(p({ runs: [txt(`ข้อมูลที่ขาด: ${q.missingFields.join(', ')}`)] }));
  }
  if (q.uncertainItems.length) {
    lines.push(p({ runs: [txt(`ข้อความที่ AI ยังไม่มั่นใจ: ${q.uncertainItems.join('; ')}`)] }));
  }
  lines.push(p({ runs: [txt('ผู้รับผิดชอบควรตรวจทานก่อนใช้เป็นเอกสารทางราชการ')] }));
  return lines;
}
