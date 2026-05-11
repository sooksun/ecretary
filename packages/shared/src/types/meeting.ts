import type { MeetingStatus, MeetingType } from '../enums';

export interface Meeting {
  id: string;
  organizationId: string;
  createdById: string;
  title: string;
  meetingType: MeetingType;
  location?: string | null;
  agendaText?: string | null;
  status: MeetingStatus;
  failureReason?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingParticipant {
  id: string;
  meetingId: string;
  userId?: string | null;
  name: string;
  roleLabel?: string | null;
  attendanceStatus: 'present' | 'absent' | 'guest';
}

export interface MeetingStatusReport {
  meetingStatus: MeetingStatus;
  chunks: {
    total: number;
    uploaded: number;
    transcribed: number;
    failed: number;
  };
  summaryStatus: 'pending' | 'processing' | 'completed' | 'failed';
}
