/**
 * Provenance helper — single source of truth for "what AI produced this
 * meeting's content?".
 *
 * Storage is deliberately split across two columns (AudioChunk.transcribe
 * Provider per-chunk, MeetingSummary.modelName per-meeting) because each is
 * the natural location for its respective fact. This module is the one
 * place that knows how to merge them into a consumer-facing shape, so
 * callers don't have to JOIN-and-collate every time they need to surface
 * "is this real, or mock?". Use the structured `provenance` field on the
 * return value when you need full detail; the flat `isMock` / `summaryModel`
 * are kept as a convenience for the mobile UI's existing banner gating.
 */

export interface MeetingProvenanceInput {
  /** MeetingSummary.modelName, or null if no summary yet. */
  summaryModelName?: string | null;
  /** MeetingSummary.promptVersion if available. */
  summaryPromptVersion?: string | null;
  /** MeetingSummary.qualityScore if available. */
  summaryQualityScore?: number | null;
  /**
   * AudioChunk.transcribeProvider for every chunk in the meeting. Each
   * entry: 'whisper', 'mock', or null (legacy chunks recorded before the
   * column existed). Pass an empty array if no chunks exist yet.
   */
  transcribeProviders: (string | null | undefined)[];
}

export interface TranscriptionProvenance {
  /**
   * 'whisper' / 'mock' / 'unknown' / 'mixed' — the latter two for legacy
   * data and for meetings whose chunks were transcribed by different
   * providers respectively.
   */
  provider: 'whisper' | 'mock' | 'unknown' | 'mixed' | 'none';
  /** Per-provider chunk count, e.g. {'whisper': 4, 'mock': 1, 'unknown': 0}. */
  chunkProviders: Record<string, number>;
  totalChunks: number;
}

export interface SummaryProvenance {
  /** Vendor-qualified model name, e.g. 'anthropic:claude-sonnet-4-6'. */
  model: string;
  promptVersion: string | null;
  qualityScore: number | null;
  isMock: boolean;
}

export interface MeetingProvenance {
  transcription: TranscriptionProvenance;
  summary: SummaryProvenance | null;
  /** True if ANY part of the meeting (transcript or summary) is mock. */
  isMock: boolean;
}

export interface MeetingProvenanceResult {
  /** Structured form — preferred for new clients. */
  provenance: MeetingProvenance;
  /** Flat aliases kept for the existing mobile banner code. */
  summaryModel: string | null;
  isMock: boolean;
}

export function computeMeetingProvenance(
  input: MeetingProvenanceInput,
): MeetingProvenanceResult {
  // ── transcription ───────────────────────────────────────────────
  const chunkProviders: Record<string, number> = {};
  for (const p of input.transcribeProviders) {
    const key = p ?? 'unknown';
    chunkProviders[key] = (chunkProviders[key] ?? 0) + 1;
  }
  const totalChunks = input.transcribeProviders.length;
  const distinct = Object.keys(chunkProviders);
  let tprovider: TranscriptionProvenance['provider'];
  if (totalChunks === 0) tprovider = 'none';
  else if (distinct.length === 1) {
    const only = distinct[0];
    tprovider =
      only === 'whisper' || only === 'mock' || only === 'unknown'
        ? only
        : 'mixed';
  } else tprovider = 'mixed';
  const transcription: TranscriptionProvenance = {
    provider: tprovider,
    chunkProviders,
    totalChunks,
  };

  // ── summary ─────────────────────────────────────────────────────
  const summaryModel = input.summaryModelName ?? null;
  // 'mock-llm-1.0' and the historical 'mock-llm-1.0+fallback' both start
  // with 'mock'. Real providers prefix with their vendor (e.g. 'anthropic:').
  const summaryIsMock = !!summaryModel && summaryModel.startsWith('mock');
  const summary: SummaryProvenance | null = summaryModel
    ? {
        model: summaryModel,
        promptVersion: input.summaryPromptVersion ?? null,
        qualityScore: input.summaryQualityScore ?? null,
        isMock: summaryIsMock,
      }
    : null;

  // ── aggregate ───────────────────────────────────────────────────
  // Don't treat 'unknown' as mock — we don't know what produced legacy
  // chunks. (For legacy meetings whose silent-fallback path produced mock
  // content, summaryModel will catch them via 'mock-llm-1.0'.)
  const transcriptHasMock = chunkProviders['mock'] > 0;
  const isMock = summaryIsMock || transcriptHasMock;

  return {
    provenance: { transcription, summary, isMock },
    summaryModel,
    isMock,
  };
}
