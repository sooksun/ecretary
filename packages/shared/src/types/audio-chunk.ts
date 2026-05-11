import type { ChunkUploadStatus, JobStatus } from '../enums';

export interface AudioChunk {
  id: string;
  meetingId: string;
  clientChunkId: string;
  chunkIndex: number;
  filePath: string;
  mimeType?: string | null;
  durationSec?: number | null;
  fileSizeBytes?: number | null;
  checksumSha256?: string | null;
  uploadStatus: ChunkUploadStatus;
  transcribeStatus: JobStatus;
  startedAtSec?: number | null;
  endedAtSec?: number | null;
  createdAt: string;
  uploadedAt?: string | null;
}

export interface ChunkUploadResponse {
  chunkId: string;
  status: ChunkUploadStatus;
  alreadyExists: boolean;
}
