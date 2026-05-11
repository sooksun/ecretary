import { api } from './client';
import { MeetingType } from '@/types/domain';

export interface ServerMeeting {
  id: string;
  title: string;
  meetingType: MeetingType;
  status: string;
  createdAt: string;
}

export const meetingsApi = {
  async create(payload: {
    title: string;
    meetingType: MeetingType;
    location?: string;
    agendaText?: string;
    participants?: { name: string; roleLabel?: string }[];
  }): Promise<ServerMeeting> {
    const { data } = await api.post('/meetings', payload);
    return data;
  },

  async list(): Promise<ServerMeeting[]> {
    const { data } = await api.get('/meetings');
    return data;
  },

  async start(id: string): Promise<void> {
    await api.post(`/meetings/${id}/start`);
  },

  async end(id: string): Promise<void> {
    await api.post(`/meetings/${id}/end`);
  },

  async getStatus(id: string): Promise<{
    meetingStatus: string;
    chunks: { total: number; uploaded: number; transcribed: number; failed: number };
    summaryStatus: string;
  }> {
    const { data } = await api.get(`/meetings/${id}/status`);
    return data;
  },

  async getBoard(id: string) {
    const { data } = await api.get(`/meetings/${id}/board`);
    return data;
  },

  /**
   * Re-enqueue any PENDING/FAILED chunks and queue a fresh summarize attempt.
   * Used by the FAILED banner on MeetingBoardScreen so the user can recover
   * without leaving the screen once infrastructure is fixed.
   */
  async process(id: string): Promise<{ reQueued: number }> {
    const { data } = await api.post(`/meetings/${id}/process`);
    return data;
  },
};
