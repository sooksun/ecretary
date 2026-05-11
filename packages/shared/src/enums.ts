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

export const JobStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  NEEDS_REVIEW: 'NEEDS_REVIEW',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export const MarkerType = {
  IMPORTANT: 'IMPORTANT',
  DECISION: 'DECISION',
  ACTION: 'ACTION',
  ISSUE: 'ISSUE',
  QUESTION: 'QUESTION',
  OTHER: 'OTHER',
} as const;
export type MarkerType = (typeof MarkerType)[keyof typeof MarkerType];

export const ActionStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  DONE: 'DONE',
  OVERDUE: 'OVERDUE',
  NEED_CLARIFICATION: 'NEED_CLARIFICATION',
  CANCELLED: 'CANCELLED',
} as const;
export type ActionStatus = (typeof ActionStatus)[keyof typeof ActionStatus];

export const ExportType = {
  PDF: 'PDF',
  DOCX: 'DOCX',
  TRANSCRIPT_TXT: 'TRANSCRIPT_TXT',
} as const;
export type ExportType = (typeof ExportType)[keyof typeof ExportType];

export const UserRole = {
  ADMIN: 'ADMIN',
  RECORDER: 'RECORDER',
  EDITOR: 'EDITOR',
  VIEWER: 'VIEWER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const QueueName = {
  TRANSCRIBE: 'transcribe',
  SUMMARIZE: 'summarize',
} as const;
export type QueueName = (typeof QueueName)[keyof typeof QueueName];
