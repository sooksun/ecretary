export interface KeyPoint {
  title: string;
  detail: string;
  confidence: number;
  sourceTimestampSec?: number | null;
}

export interface Decision {
  decision: string;
  rationale?: string | null;
  confidence: number;
  sourceTimestampSec?: number | null;
}

export interface ActionItemDraft {
  title: string;
  description?: string | null;
  assigneeName?: string | null;
  dueDate?: string | null;
  evidenceRequired?: string | null;
  confidence: number;
  sourceTimestampSec?: number | null;
}

export interface Risk {
  risk: string;
  impact?: string | null;
  recommendation?: string | null;
  confidence: number;
}

export interface PendingQuestion {
  question: string;
  owner?: string | null;
  confidence: number;
}

export interface OfficialMinutesAgendaItem {
  agendaNo: string;
  topic: string;
  discussion: string;
  resolution?: string | null;
}

export interface OfficialMinutes {
  title: string;
  dateText: string;
  location?: string | null;
  attendees: string[];
  absentees: string[];
  participants?: string[];
  agendaItems: OfficialMinutesAgendaItem[];
  closedAt?: string | null;
  minuteTaker?: string | null;
  reviewer?: string | null;
}

export interface QualityCheck {
  missingFields: string[];
  uncertainItems: string[];
  recommendations: string[];
}

export interface SummaryOutput {
  executiveSummary: string;
  keyPoints: KeyPoint[];
  decisions: Decision[];
  actionItems: ActionItemDraft[];
  risks: Risk[];
  pendingQuestions: PendingQuestion[];
  officialMinutes: OfficialMinutes;
  qualityCheck: QualityCheck;
}

export interface TranscriptionProvenance {
  /** Aggregate descriptor across all chunks. */
  provider: 'whisper' | 'mock' | 'unknown' | 'mixed' | 'none';
  /** Per-provider chunk counts, e.g. { whisper: 4, mock: 1 }. */
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

/**
 * Single canonical view of "what AI produced this meeting's content".
 * Returned by /meetings/:id, /meetings/:id/board, and /meetings/:id/summary.
 * See apps/api/src/common/meeting-provenance.ts for the computation rules.
 */
export interface MeetingProvenance {
  transcription: TranscriptionProvenance;
  summary: SummaryProvenance | null;
  isMock: boolean;
}

export interface MeetingBoard {
  meetingId: string;
  status: string;
  failureReason?: string | null;
  summary: SummaryOutput | null;
  /**
   * @deprecated read from `provenance.summary.model` instead. Kept for the
   * existing mobile banner code; will be removed once mobile migrates.
   */
  summaryModel?: string | null;
  /** Convenience flag mirroring `provenance.isMock`. */
  isMock?: boolean;
  /** Structured provenance — preferred for new clients. */
  provenance?: MeetingProvenance;
  participants: { name: string; roleLabel?: string | null }[];
  markers: { markerType: string; timestampSec: number; note?: string | null }[];
  actionItems: { id: string; title: string; assigneeName?: string | null; dueDate?: string | null; status: string }[];
}
