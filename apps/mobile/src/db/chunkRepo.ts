import { getDb } from './sqlite';
import { ChunkUploadStatus, LocalChunk } from '@/types/domain';
import * as Crypto from 'expo-crypto';

interface ChunkRow {
  id: string;
  meeting_id: string;
  server_id: string | null;
  client_chunk_id: string;
  chunk_index: number;
  file_uri: string;
  checksum_sha256: string | null;
  duration_sec: number | null;
  file_size_bytes: number | null;
  upload_status: string;
  started_at_sec: number | null;
  ended_at_sec: number | null;
  retry_count: number;
  created_at: string;
  uploaded_at: string | null;
}

const fromRow = (r: ChunkRow): LocalChunk => ({
  id: r.id,
  meetingId: r.meeting_id,
  serverId: r.server_id,
  clientChunkId: r.client_chunk_id,
  chunkIndex: r.chunk_index,
  fileUri: r.file_uri,
  checksumSha256: r.checksum_sha256,
  durationSec: r.duration_sec,
  fileSizeBytes: r.file_size_bytes,
  uploadStatus: r.upload_status as ChunkUploadStatus,
  startedAtSec: r.started_at_sec,
  endedAtSec: r.ended_at_sec,
  retryCount: r.retry_count,
  createdAt: r.created_at,
  uploadedAt: r.uploaded_at,
});

export const chunkRepo = {
  async insert(input: {
    meetingId: string;
    chunkIndex: number;
    fileUri: string;
    durationSec: number;
    fileSizeBytes: number;
    checksumSha256?: string;
    startedAtSec: number;
    endedAtSec: number;
  }): Promise<LocalChunk> {
    const db = await getDb();
    const id = Crypto.randomUUID();
    const clientChunkId = `${input.meetingId}-${input.chunkIndex}-${id.slice(0, 8)}`;
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO local_audio_chunks
        (id, meeting_id, client_chunk_id, chunk_index, file_uri,
         checksum_sha256, duration_sec, file_size_bytes,
         upload_status, started_at_sec, ended_at_sec, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.meetingId,
        clientChunkId,
        input.chunkIndex,
        input.fileUri,
        input.checksumSha256 ?? null,
        input.durationSec,
        input.fileSizeBytes,
        ChunkUploadStatus.QUEUED,
        input.startedAtSec,
        input.endedAtSec,
        now,
      ],
    );
    await db.runAsync(
      `INSERT OR IGNORE INTO local_upload_queue(id, chunk_id, attempt_count) VALUES (?, ?, 0)`,
      [Crypto.randomUUID(), id],
    );
    const row = (await db.getFirstAsync<ChunkRow>(
      `SELECT * FROM local_audio_chunks WHERE id = ?`,
      [id],
    )) as ChunkRow;
    return fromRow(row);
  },

  async listByMeeting(meetingId: string): Promise<LocalChunk[]> {
    const db = await getDb();
    const rows = (await db.getAllAsync<ChunkRow>(
      `SELECT * FROM local_audio_chunks WHERE meeting_id = ? ORDER BY chunk_index ASC`,
      [meetingId],
    )) as ChunkRow[];
    return rows.map(fromRow);
  },

  async listPendingUploads(limit = 5): Promise<LocalChunk[]> {
    const db = await getDb();
    const now = new Date().toISOString();
    // Only return chunks whose backoff window has expired (or never set).
    // next_attempt_at IS NULL  → newly queued, ready immediately.
    // next_attempt_at <= now   → backoff elapsed, ready to retry.
    const rows = (await db.getAllAsync<ChunkRow>(
      `SELECT c.* FROM local_audio_chunks c
       JOIN local_upload_queue q ON q.chunk_id = c.id
       WHERE c.upload_status IN (?, ?)
         AND (q.next_attempt_at IS NULL OR q.next_attempt_at <= ?)
       ORDER BY c.created_at ASC LIMIT ?`,
      [ChunkUploadStatus.QUEUED, ChunkUploadStatus.FAILED_RETRY, now, limit],
    )) as ChunkRow[];
    return rows.map(fromRow);
  },

  async scheduleRetry(chunkId: string, delayMs: number, error?: string): Promise<void> {
    const db = await getDb();
    const nextAt = new Date(Date.now() + delayMs).toISOString();
    await db.runAsync(
      `UPDATE local_upload_queue
         SET next_attempt_at = ?,
             attempt_count   = attempt_count + 1,
             last_error      = COALESCE(?, last_error)
       WHERE chunk_id = ?`,
      [nextAt, error ?? null, chunkId],
    );
  },

  async setStatus(
    id: string,
    status: ChunkUploadStatus,
    extra?: { serverId?: string; uploadedAt?: string; bumpRetry?: boolean },
  ): Promise<void> {
    const db = await getDb();
    if (extra?.bumpRetry) {
      await db.runAsync(
        `UPDATE local_audio_chunks
           SET upload_status = ?,
               retry_count = retry_count + 1,
               server_id = COALESCE(?, server_id),
               uploaded_at = COALESCE(?, uploaded_at)
         WHERE id = ?`,
        [status, extra?.serverId ?? null, extra?.uploadedAt ?? null, id],
      );
    } else {
      await db.runAsync(
        `UPDATE local_audio_chunks
           SET upload_status = ?,
               server_id = COALESCE(?, server_id),
               uploaded_at = COALESCE(?, uploaded_at)
         WHERE id = ?`,
        [status, extra?.serverId ?? null, extra?.uploadedAt ?? null, id],
      );
    }
  },

  async countByStatusForMeeting(meetingId: string): Promise<Record<string, number>> {
    const db = await getDb();
    const rows = (await db.getAllAsync<{ upload_status: string; n: number }>(
      `SELECT upload_status, COUNT(*) as n FROM local_audio_chunks
       WHERE meeting_id = ?
       GROUP BY upload_status`,
      [meetingId],
    )) as { upload_status: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.upload_status, r.n]));
  },
};
