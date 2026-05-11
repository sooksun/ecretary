/**
 * Transcription provider interface.
 *
 * Phase A ships a deterministic mock so the rest of the pipeline
 * (queue → DB → summary → board) can be exercised end-to-end without
 * faster-whisper. M3 adds WhisperHttpProvider that POSTs the chunk
 * audio to the in-network whisper FastAPI service. Selection is via
 * AI_PROVIDER env var (`mock` | `whisper`).
 */
export interface TranscriptSegmentResult {
  start: number;
  end: number;
  text: string;
  language: string;
  confidence: number;
}

export interface TranscribeInput {
  chunkId: string;
  chunkIndex: number;
  durationSec: number;
  /** S3 key of the chunk file. Real providers use this to fetch audio. */
  filePath?: string;
  mimeType?: string | null;
}

export interface TranscriptionProvider {
  /** Stable identifier persisted to AudioChunk.transcribeProvider for audit. */
  readonly providerName: string;
  transcribe(input: TranscribeInput): Promise<TranscriptSegmentResult[]>;
}

const THAI_SAMPLES = [
  'สวัสดีครับวันนี้เรามาประชุมเรื่องการอ่านออกเขียนได้ของนักเรียนชั้นประถม',
  'ผมเสนอให้ใช้กิจกรรมส่งเสริมการอ่านในช่วงพักกลางวัน',
  'ครูสมศรีรับไปประสานกับครูประจำชั้นและสรุปแผนภายในสัปดาห์นี้',
  'เราต้องเตรียมหนังสือให้เพียงพอ และทำตารางหมุนเวียนกลุ่ม',
  'มติที่ประชุมเห็นชอบให้ดำเนินการในวันที่ 15 ของเดือนหน้า',
  'มีคำถามจากครูวิภาว่าใครรับผิดชอบประเมินผล',
  'ผอ. ขอให้รายงานความก้าวหน้าทุกสองสัปดาห์',
  'เลิกประชุมเวลา 16 นาฬิกา',
];

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly providerName = 'mock';
  async transcribe(input: TranscribeInput): Promise<TranscriptSegmentResult[]> {
    const duration = Math.max(60, input.durationSec || 300);
    const segmentLen = 30;
    const segments: TranscriptSegmentResult[] = [];
    const offset = (input.chunkIndex * THAI_SAMPLES.length) % THAI_SAMPLES.length;

    let cursor = 0;
    let i = 0;
    while (cursor < duration) {
      segments.push({
        start: cursor,
        end: Math.min(cursor + segmentLen, duration),
        text: THAI_SAMPLES[(offset + i) % THAI_SAMPLES.length],
        language: 'th',
        confidence: 0.78 + (i % 3) * 0.05,
      });
      cursor += segmentLen;
      i += 1;
    }
    return segments;
  }
}
