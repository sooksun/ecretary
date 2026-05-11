import * as Network from 'expo-network';
import { chunkRepo } from '@/db/chunkRepo';
import { ChunkUploadStatus } from '@/types/domain';
import { chunksApi } from '@/api/chunks';
import { meetingRepo } from '@/db/meetingRepo';
import { meetingsApi } from '@/api/meetings';
import { useAuthStore } from '@/store/auth';

const BACKOFF_BASE_MS = 5_000;
const MAX_RETRIES = 6;

function backoffMs(retryCount: number): number {
  return BACKOFF_BASE_MS * Math.min(8, 2 ** retryCount);
}

interface UploaderOpts {
  poll?: number;
}

export class UploadQueueService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly pollMs: number;

  constructor(opts: UploaderOpts = {}) {
    this.pollMs = opts.poll ?? 4_000;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Force a manual tick (used by Recording screen "retry now"). */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      if (!useAuthStore.getState().token) return; // not signed in — skip
      const online = await this.isOnline();
      if (!online) return;

      // Sync pending meeting start/end actions before uploading chunks.
      const pendingSyncs = await meetingRepo.listPendingSync();
      for (const m of pendingSyncs) {
        if (!m.serverId) continue; // server not yet assigned — retry next tick
        try {
          if (m.pendingSync === 'start') await meetingsApi.start(m.serverId);
          else if (m.pendingSync === 'end') await meetingsApi.end(m.serverId);
          await meetingRepo.setPendingSync(m.id, null);
        } catch {
          // will retry next tick
        }
      }

      const pending = await chunkRepo.listPendingUploads(3);
      for (const chunk of pending) {
        if (chunk.retryCount >= MAX_RETRIES) {
          await chunkRepo.setStatus(chunk.id, ChunkUploadStatus.FAILED_FINAL);
          continue;
        }
        try {
          const meeting = await meetingRepo.getById(chunk.meetingId);
          if (!meeting?.serverId) continue; // wait until meeting is synced

          await chunkRepo.setStatus(chunk.id, ChunkUploadStatus.UPLOADING);
          const result = await chunksApi.upload(meeting.serverId, chunk.fileUri, {
            clientChunkId: chunk.clientChunkId,
            chunkIndex: chunk.chunkIndex,
            durationSec: chunk.durationSec ?? 0,
            startedAtSec: chunk.startedAtSec ?? 0,
            endedAtSec: chunk.endedAtSec ?? 0,
            checksumSha256: chunk.checksumSha256 ?? undefined,
            mimeType: 'audio/mp4',
          });
          await chunkRepo.setStatus(chunk.id, ChunkUploadStatus.UPLOADED, {
            serverId: result.chunkId,
            uploadedAt: new Date().toISOString(),
          });
        } catch (err) {
          const message = (err as Error).message;
          // Record failure and schedule next attempt via next_attempt_at.
          // Do NOT sleep here — other pending chunks continue immediately;
          // this chunk will reappear in listPendingUploads once the window elapses.
          await chunkRepo.setStatus(chunk.id, ChunkUploadStatus.FAILED_RETRY, { bumpRetry: true });
          await chunkRepo.scheduleRetry(chunk.id, backoffMs(chunk.retryCount), message);
          // eslint-disable-next-line no-console
          console.warn('[upload] failed', chunk.id, message);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async isOnline(): Promise<boolean> {
    try {
      const s = await Network.getNetworkStateAsync();
      return Boolean(s.isConnected && s.isInternetReachable !== false);
    } catch {
      return false;
    }
  }
}

export const uploadQueue = new UploadQueueService();
