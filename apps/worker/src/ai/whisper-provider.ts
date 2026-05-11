import { storage } from '../storage';
import { logger } from '../logger';
import type {
  TranscribeInput,
  TranscriptSegmentResult,
  TranscriptionProvider,
} from './transcription';

interface WhisperServiceSegment {
  start: number;
  end: number;
  text: string;
  language: string;
  confidence: number;
}

interface WhisperServiceResponse {
  modelName: string;
  durationSec: number;
  segments: WhisperServiceSegment[];
}

/**
 * WhisperHttpProvider — fetches the chunk from S3, POSTs it to the
 * in-network whisper FastAPI service as multipart/form-data, and maps
 * the response into TranscriptSegmentResult[].
 *
 * The whisper service holds the model in RAM; this provider is stateless.
 */
export class WhisperHttpProvider implements TranscriptionProvider {
  readonly providerName = 'whisper';
  private readonly endpoint: string;
  private readonly language: string;
  private readonly timeoutMs: number;

  constructor() {
    const raw = process.env.WHISPER_ENDPOINT ?? 'http://localhost:9001';
    this.endpoint = raw.replace(/\/+$/, '');
    this.language = process.env.WHISPER_LANGUAGE ?? 'th';
    // 5-min chunk × ~3× real-time worst case + headroom
    this.timeoutMs = Number(process.env.WHISPER_TIMEOUT_MS ?? 30 * 60 * 1000);
  }

  async transcribe(input: TranscribeInput): Promise<TranscriptSegmentResult[]> {
    if (!input.filePath) {
      throw new Error('WhisperHttpProvider requires chunk.filePath (S3 key)');
    }

    logger.info({ chunkId: input.chunkId, key: input.filePath }, 'whisper.fetchChunk');
    const buf = await storage.getObjectBuffer(input.filePath);

    const fileName = input.filePath.split('/').pop() ?? `${input.chunkId}.m4a`;
    const mime = input.mimeType ?? 'audio/mp4';
    const blob = new Blob([new Uint8Array(buf)], { type: mime });
    const form = new FormData();
    form.append('file', blob, fileName);
    form.append('language', this.language);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      logger.info(
        { chunkId: input.chunkId, bytes: buf.length, endpoint: this.endpoint },
        'whisper.post',
      );
      res = await fetch(`${this.endpoint}/transcribe`, {
        method: 'POST',
        body: form,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`whisper service ${res.status}: ${detail.slice(0, 200)}`);
    }

    const json = (await res.json()) as WhisperServiceResponse;
    if (!Array.isArray(json.segments)) {
      throw new Error('whisper response missing segments[]');
    }

    return json.segments.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
      language: s.language || this.language,
      confidence: s.confidence,
    }));
  }
}
