import { getDb } from './sqlite';
import { LocalMeeting, MeetingStatus, MeetingType } from '@/types/domain';
import * as Crypto from 'expo-crypto';

interface MeetingRow {
  id: string;
  server_id: string | null;
  title: string;
  meeting_type: string;
  location: string | null;
  agenda_text: string | null;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  pending_sync: string | null;
  created_at: string;
  updated_at: string;
}

const fromRow = (r: MeetingRow): LocalMeeting => ({
  id: r.id,
  serverId: r.server_id,
  title: r.title,
  meetingType: r.meeting_type as MeetingType,
  location: r.location,
  agendaText: r.agenda_text,
  status: r.status as MeetingStatus,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  pendingSync: r.pending_sync === 'start' || r.pending_sync === 'end' ? r.pending_sync : null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export const meetingRepo = {
  async create(input: {
    title: string;
    meetingType: MeetingType;
    location?: string;
    agendaText?: string;
  }): Promise<LocalMeeting> {
    const db = await getDb();
    const id = Crypto.randomUUID();
    const now = new Date().toISOString();
    await db.runAsync(
      `INSERT INTO local_meetings(id, title, meeting_type, location, agenda_text, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.title,
        input.meetingType,
        input.location ?? null,
        input.agendaText ?? null,
        MeetingStatus.DRAFT,
        now,
        now,
      ],
    );
    const row = (await db.getFirstAsync<MeetingRow>(
      `SELECT * FROM local_meetings WHERE id = ?`,
      [id],
    )) as MeetingRow;
    return fromRow(row);
  },

  async list(): Promise<LocalMeeting[]> {
    const db = await getDb();
    const rows = (await db.getAllAsync<MeetingRow>(
      `SELECT * FROM local_meetings ORDER BY created_at DESC LIMIT 100`,
    )) as MeetingRow[];
    return rows.map(fromRow);
  },

  async getById(id: string): Promise<LocalMeeting | null> {
    const db = await getDb();
    const row = (await db.getFirstAsync<MeetingRow>(
      `SELECT * FROM local_meetings WHERE id = ?`,
      [id],
    )) as MeetingRow | null;
    return row ? fromRow(row) : null;
  },

  async setStatus(id: string, status: MeetingStatus): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE local_meetings SET status = ?, updated_at = ? WHERE id = ?`,
      [status, new Date().toISOString(), id],
    );
  },

  /**
   * Adopt the server's status for rows we've already pushed (server_id set).
   * Returns how many rows actually changed, so callers can skip a re-render.
   *
   * RECORDING is never overwritten: while the device is recording it owns that
   * state, and the server still holds the meeting at DRAFT/RECORDING until the
   * chunks land. Every state after upload (TRANSCRIBING → SUMMARIZING →
   * READY/FAILED) is decided by the backend, so there the server value wins.
   */
  async applyServerStatuses(byServerId: Record<string, string>): Promise<number> {
    const entries = Object.entries(byServerId);
    if (entries.length === 0) return 0;
    const db = await getDb();
    const now = new Date().toISOString();
    let changed = 0;
    for (const [serverId, status] of entries) {
      const res = await db.runAsync(
        `UPDATE local_meetings
            SET status = ?, updated_at = ?
          WHERE server_id = ? AND status <> ? AND status <> ?`,
        [status, now, serverId, status, MeetingStatus.RECORDING],
      );
      changed += res.changes ?? 0;
    }
    return changed;
  },

  async setServerId(id: string, serverId: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE local_meetings SET server_id = ?, updated_at = ? WHERE id = ?`,
      [serverId, new Date().toISOString(), id],
    );
  },

  async setStartedAt(id: string, iso: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE local_meetings SET started_at = ?, updated_at = ? WHERE id = ?`,
      [iso, new Date().toISOString(), id],
    );
  },

  async setEndedAt(id: string, iso: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE local_meetings SET ended_at = ?, updated_at = ? WHERE id = ?`,
      [iso, new Date().toISOString(), id],
    );
  },

  async findRecording(): Promise<LocalMeeting[]> {
    const db = await getDb();
    const rows = (await db.getAllAsync<MeetingRow>(
      `SELECT * FROM local_meetings WHERE status = ?`,
      [MeetingStatus.RECORDING],
    )) as MeetingRow[];
    return rows.map(fromRow);
  },

  async setPendingSync(id: string, action: 'start' | 'end' | null): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `UPDATE local_meetings SET pending_sync = ?, updated_at = ? WHERE id = ?`,
      [action, new Date().toISOString(), id],
    );
  },

  async listPendingSync(): Promise<LocalMeeting[]> {
    const db = await getDb();
    const rows = (await db.getAllAsync<MeetingRow>(
      `SELECT * FROM local_meetings WHERE pending_sync IS NOT NULL`,
    )) as MeetingRow[];
    return rows.map(fromRow);
  },

  async listUnsynced(): Promise<LocalMeeting[]> {
    const db = await getDb();
    const rows = (await db.getAllAsync<MeetingRow>(
      `SELECT * FROM local_meetings WHERE server_id IS NULL`,
    )) as MeetingRow[];
    return rows.map(fromRow);
  },
};
