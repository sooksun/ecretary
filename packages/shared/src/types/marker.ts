import type { MarkerType } from '../enums';

export interface MeetingMarker {
  id: string;
  meetingId: string;
  markerType: MarkerType;
  timestampSec: number;
  note?: string | null;
  createdById?: string | null;
  createdAt: string;
}
