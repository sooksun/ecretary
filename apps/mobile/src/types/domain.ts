/**
 * Lightweight mirror of @msec/shared types so the mobile bundle does not
 * pull the workspace package (Metro and npm workspaces don't always agree).
 * Keep these in sync with packages/shared/src.
 */

export const MeetingStatus = {
  DRAFT: 'DRAFT',
  RECORDING: 'RECORDING',
  UPLOADING: 'UPLOADING',
  PROCESSING: 'PROCESSING',
  TRANSCRIBING: 'TRANSCRIBING',
  SUMMARIZING: 'SUMMARIZING',
  READY: 'READY',
  FAILED: 'FAILED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type MeetingStatus = (typeof MeetingStatus)[keyof typeof MeetingStatus];

export const MeetingType = {
  GENERAL: 'GENERAL',
  SCHOOL_ADMIN: 'SCHOOL_ADMIN',
  PLC: 'PLC',
  PROJECT: 'PROJECT',
  PARENT_MEETING: 'PARENT_MEETING',
  COMMITTEE: 'COMMITTEE',
  TRAINING: 'TRAINING',
  SUPERVISION: 'SUPERVISION',
} as const;
export type MeetingType = (typeof MeetingType)[keyof typeof MeetingType];

export const ChunkUploadStatus = {
  LOCAL_ONLY: 'LOCAL_ONLY',
  QUEUED: 'QUEUED',
  UPLOADING: 'UPLOADING',
  UPLOADED: 'UPLOADED',
  PROCESSING: 'PROCESSING',
  TRANSCRIBED: 'TRANSCRIBED',
  FAILED_RETRY: 'FAILED_RETRY',
  FAILED_FINAL: 'FAILED_FINAL',
  DONE: 'DONE',
} as const;
export type ChunkUploadStatus = (typeof ChunkUploadStatus)[keyof typeof ChunkUploadStatus];

export const MarkerType = {
  IMPORTANT: 'IMPORTANT',
  DECISION: 'DECISION',
  ACTION: 'ACTION',
  ISSUE: 'ISSUE',
  QUESTION: 'QUESTION',
  OTHER: 'OTHER',
} as const;
export type MarkerType = (typeof MarkerType)[keyof typeof MarkerType];

export interface LocalMeeting {
  id: string;
  serverId: string | null;
  title: string;
  meetingType: MeetingType;
  location: string | null;
  agendaText: string | null;
  status: MeetingStatus;
  startedAt: string | null;
  endedAt: string | null;
  pendingSync: 'start' | 'end' | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalChunk {
  id: string;
  meetingId: string;
  serverId: string | null;
  clientChunkId: string;
  chunkIndex: number;
  fileUri: string;
  checksumSha256: string | null;
  durationSec: number | null;
  fileSizeBytes: number | null;
  uploadStatus: ChunkUploadStatus;
  startedAtSec: number | null;
  endedAtSec: number | null;
  retryCount: number;
  createdAt: string;
  uploadedAt: string | null;
}

export interface LocalMarker {
  id: string;
  meetingId: string;
  markerType: MarkerType;
  timestampSec: number;
  note: string | null;
  syncStatus: 'pending' | 'synced';
  createdAt: string;
}
