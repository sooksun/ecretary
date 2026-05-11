import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PdfPrinter from 'pdfmake';
import type { Content, TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces';
import type { OfficialMinutes, SummaryOutput } from '@msec/shared';

interface RenderInput {
  meetingTitle: string;
  meetingType: string;
  organizationName?: string | null;
  summary: SummaryOutput;
}

const FONT_DIR = join(process.cwd(), 'assets', 'fonts');

interface FontPaths {
  fontFamily: string;
  fonts: TFontDictionary;
  thaiSupported: boolean;
}

let cachedFonts: FontPaths | null = null;

/**
 * Sarabun is the only supported font for PDF export. pdfmake doesn't ship
 * a fallback TTF in its npm distribution (the `examples/fonts/` Roboto
 * files only exist in the GitHub repo). Without Sarabun, PDF export is
 * not possible; DOCX export keeps working because Word/LibreOffice
 * supplies fonts at open time.
 */
function resolveFonts(): FontPaths {
  if (cachedFonts) return cachedFonts;

  const sarabunRegular = join(FONT_DIR, 'Sarabun-Regular.ttf');
  if (!existsSync(sarabunRegular)) {
    throw new Error(
      'PDF export requires Sarabun fonts. Drop Sarabun-Regular.ttf (and ' +
        'optionally Bold/Italic/BoldItalic variants) into apps/api/assets/fonts/. ' +
        'See apps/api/assets/fonts/README.md for the download link. ' +
        'DOCX export does not need this font.',
    );
  }

  const sarabunBold = join(FONT_DIR, 'Sarabun-Bold.ttf');
  const sarabunItalic = join(FONT_DIR, 'Sarabun-Italic.ttf');
  const sarabunBoldItalic = join(FONT_DIR, 'Sarabun-BoldItalic.ttf');
  cachedFonts = {
    fontFamily: 'Sarabun',
    thaiSupported: true,
    fonts: {
      Sarabun: {
        normal: sarabunRegular,
        bold: existsSync(sarabunBold) ? sarabunBold : sarabunRegular,
        italics: existsSync(sarabunItalic) ? sarabunItalic : sarabunRegular,
        bolditalics: existsSync(sarabunBoldItalic) ? sarabunBoldItalic : sarabunRegular,
      },
    },
  };
  return cachedFonts;
}

export async function renderMinutesPdf(input: RenderInput): Promise<Buffer> {
  const fontConfig = resolveFonts();
  const printer = new PdfPrinter(fontConfig.fonts);
  const m = input.summary.officialMinutes;

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [60, 60, 60, 60],
    defaultStyle: { font: fontConfig.fontFamily, fontSize: 14 },
    styles: {
      orgHeader: { fontSize: 16, bold: true, alignment: 'center' },
      title: { fontSize: 20, bold: true, alignment: 'center', margin: [0, 8, 0, 4] },
      dateLine: { alignment: 'center', margin: [0, 0, 0, 16] },
      h2: { fontSize: 15, bold: true, margin: [0, 12, 0, 6] },
      agendaTitle: { fontSize: 14, bold: true, margin: [0, 8, 0, 2] },
      label: { bold: true },
      footer: { fontSize: 10, color: '#666666', alignment: 'center', italics: true },
    },
    footer: (currentPage, pageCount) => ({
      text: `หน้า ${currentPage} / ${pageCount}`,
      alignment: 'center',
      fontSize: 10,
      margin: [0, 20, 0, 0],
    }),
    content: ([
      input.organizationName
        ? { text: input.organizationName, style: 'orgHeader' }
        : { text: 'รายงานการประชุม', style: 'orgHeader' },
      { text: m.title, style: 'title' },
      { text: m.dateText, style: 'dateLine' },
      ...(m.location ? [{ text: `สถานที่: ${m.location}`, alignment: 'center', margin: [0, 0, 0, 8] }] : []),

      { text: 'ผู้มาประชุม', style: 'h2' },
      ...numberedList(m.attendees, 'ไม่มีรายชื่อผู้เข้าประชุม'),

      { text: 'ผู้ไม่มาประชุม', style: 'h2' },
      ...numberedList(m.absentees, '— ไม่มี —'),

      ...(m.participants && m.participants.length
        ? [{ text: 'ผู้เข้าร่วมประชุม', style: 'h2' }, ...numberedList(m.participants, '')]
        : []),

      { text: 'ระเบียบวาระการประชุม', style: 'h2' },
      ...m.agendaItems.flatMap((a) => agendaBlock(a)),

      ...renderActionItemsTable(input.summary),

      ...(m.closedAt ? [{ text: 'เลิกประชุม', style: 'h2' }, { text: m.closedAt }] : []),

      ...renderSignerTable(m),

      ...renderQualityNote(input.summary),
    ] as unknown) as Content[],
  };

  const pdfDoc = printer.createPdfKitDocument(docDefinition);
  const chunks: Buffer[] = [];
  return await new Promise<Buffer>((resolve, reject) => {
    pdfDoc.on('data', (c: Buffer) => chunks.push(c));
    pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
    pdfDoc.on('error', reject);
    pdfDoc.end();
  });
}

// ── helpers ────────────────────────────────────────────────────────────

function numberedList(items: string[], emptyLabel: string) {
  if (!items.length) return [{ text: emptyLabel }];
  return items.map((line, i) => ({ text: `${i + 1}. ${line}` }));
}

function agendaBlock(item: { agendaNo: string; topic: string; discussion: string; resolution?: string | null }) {
  const blocks: Array<{ text: unknown; style?: string; margin?: [number, number, number, number] }> = [
    { text: `วาระที่ ${item.agendaNo}: ${item.topic}`, style: 'agendaTitle' },
    { text: [{ text: 'การอภิปราย: ', bold: true }, item.discussion], margin: [0, 0, 0, 4] },
  ];
  if (item.resolution) {
    blocks.push({
      text: [{ text: 'มติที่ประชุม: ', bold: true }, item.resolution],
      margin: [0, 0, 0, 8],
    });
  }
  return blocks;
}

function renderActionItemsTable(summary: SummaryOutput) {
  if (!summary.actionItems.length) return [];
  return [
    { text: 'งานที่มอบหมาย', style: 'h2' as const },
    {
      table: {
        headerRows: 1,
        widths: ['*', 'auto', 'auto', '*'],
        body: [
          [
            { text: 'งาน', style: 'label' },
            { text: 'ผู้รับผิดชอบ', style: 'label' },
            { text: 'กำหนดส่ง', style: 'label' },
            { text: 'หลักฐาน', style: 'label' },
          ],
          ...summary.actionItems.map((a) => [
            a.title,
            a.assigneeName ?? '—',
            a.dueDate ?? '—',
            a.evidenceRequired ?? '—',
          ]),
        ],
      },
      margin: [0, 0, 0, 12] as [number, number, number, number],
    },
  ];
}

function renderSignerTable(m: OfficialMinutes) {
  return [
    {
      table: {
        widths: ['*', '*'],
        body: [
          [
            {
              border: [false, false, false, false],
              stack: [
                { text: '(ลงชื่อ) ............................................', alignment: 'center' as const },
                { text: `(${m.minuteTaker ?? '...........................'})`, alignment: 'center' as const },
                { text: 'ผู้บันทึกรายงานการประชุม', alignment: 'center' as const },
              ],
            },
            {
              border: [false, false, false, false],
              stack: [
                { text: '(ลงชื่อ) ............................................', alignment: 'center' as const },
                { text: `(${m.reviewer ?? '...........................'})`, alignment: 'center' as const },
                { text: 'ผู้ตรวจรายงานการประชุม', alignment: 'center' as const },
              ],
            },
          ],
        ],
      },
      layout: 'noBorders',
      margin: [0, 32, 0, 0] as [number, number, number, number],
    },
  ];
}

function renderQualityNote(summary: SummaryOutput) {
  const q = summary.qualityCheck;
  if (!q.missingFields.length && !q.uncertainItems.length) return [];
  const lines: Array<{ text: unknown; style?: string }> = [
    { text: 'หมายเหตุการตรวจสอบ (AI quality check)', style: 'h2' },
  ];
  if (q.missingFields.length) {
    lines.push({ text: `ข้อมูลที่ขาด: ${q.missingFields.join(', ')}` });
  }
  if (q.uncertainItems.length) {
    lines.push({ text: `ข้อความที่ AI ยังไม่มั่นใจ: ${q.uncertainItems.join('; ')}` });
  }
  lines.push({ text: 'ผู้รับผิดชอบควรตรวจทานก่อนใช้เป็นเอกสารทางราชการ' });
  return lines;
}

// Suppress unused import warning — fs is reserved for future async font loading.
void fs;
