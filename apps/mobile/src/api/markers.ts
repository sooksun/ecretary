import { api } from './client';
import { MarkerType } from '@/types/domain';

export interface ServerMarker {
  id: string;
  meetingId: string;
  markerType: MarkerType;
  timestampSec: number;
  note: string | null;
  createdAt: string;
}

export const markersApi = {
  async create(
    meetingId: string,
    payload: { markerType: MarkerType; timestampSec: number; note?: string | null },
  ): Promise<ServerMarker> {
    const { data } = await api.post(`/meetings/${meetingId}/markers`, payload);
    return data;
  },
};
