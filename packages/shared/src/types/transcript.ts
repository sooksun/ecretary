export interface TranscriptSegment {
  id: string;
  meetingId: string;
  audioChunkId: string;
  startTimeSec: number;
  endTimeSec: number;
  text: string;
  language?: string | null;
  confidence?: number | null;
  createdAt: string;
}
