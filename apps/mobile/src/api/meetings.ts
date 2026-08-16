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

  async list(params?: {
    status?: string;
    q?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: ServerMeeting[]; nextCursor: string | null }> {
    const { data } = await api.get('/meetings', { params });
    return data;
  },

  async start(id: string): Promise<void> {
    await api.post(`/meetings/${id}/start`);
  },

  async end(id: string, totalChunks?: number): Promise<void> {
    await api.post(`/meetings/${id}/end`, { totalChunks });
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

  /**
   * Generate a downloadable export of the meeting (DOCX / PDF / TRANSCRIPT_TXT).
   * The API renders the file synchronously and returns a signed S3 URL valid
   * for ~1 hour.
   */
  async createExport(
    id: string,
    exportType: 'DOCX' | 'PDF' | 'TRANSCRIPT_TXT',
  ): Promise<{
    id: string;
    exportType: string;
    filePath: string;
    downloadUrl: string;
    createdAt: string;
  }> {
    const { data } = await api.post(`/meetings/${id}/exports`, { exportType });
    return data;
  },
};
