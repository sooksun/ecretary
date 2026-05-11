import { api } from './client';
import { ChunkUploadStatus } from '@/types/domain';

export interface UploadResult {
  chunkId: string;
  status: ChunkUploadStatus;
  alreadyExists: boolean;
}

export const chunksApi = {
  async upload(
    meetingServerId: string,
    fileUri: string,
    meta: {
      clientChunkId: string;
      chunkIndex: number;
      durationSec: number;
      startedAtSec: number;
      endedAtSec: number;
      checksumSha256?: string;
      mimeType?: string;
    },
  ): Promise<UploadResult> {
    const form = new FormData();
    form.append('file', {
      uri: fileUri,
      name: `${meta.clientChunkId}.m4a`,
      type: meta.mimeType ?? 'audio/mp4',
    } as unknown as Blob);
    form.append('clientChunkId', meta.clientChunkId);
    form.append('chunkIndex', String(meta.chunkIndex));
    form.append('durationSec', String(meta.durationSec));
    form.append('startedAtSec', String(meta.startedAtSec));
    form.append('endedAtSec', String(meta.endedAtSec));
    if (meta.checksumSha256) form.append('checksumSha256', meta.checksumSha256);
    if (meta.mimeType) form.append('mimeType', meta.mimeType);

    const { data } = await api.post(
      `/meetings/${meetingServerId}/audio-chunks`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return data;
  },
};
