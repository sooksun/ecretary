import { getDb } from './sqlite';
import { LocalMarker, MarkerType } from '@/types/domain';
import * as Crypto from 'expo-crypto';

interface MarkerRow {
  id: string;
  meeting_id: string;
  marker_type: string;
  timestamp_sec: number;
  note: string | null;
  sync_status: string;
  created_at: string;
}

const fromRow = (r: MarkerRow): LocalMarker => ({
  id: r.id,
  meetingId: r.meeting_id,
  markerType: r.marker_type as MarkerType,
  timestampSec: r.timestamp_sec,
  note: r.note,
  syncStatus: r.sync_status as 'pending' | 'synced',
  createdAt: r.created_at,
});

export const markerRepo = {
  async add(input: {
    meetingId: string;
    markerType: MarkerType;
    timestampSec: number;
    note?: string;
  }): Promise<LocalMarker> {
    const db = await getDb();
    const id = Crypto.randomUUID();
    await db.runAsync(
      `INSERT INTO local_markers(id, meeting_id, marker_type, timestamp_sec, note, sync_status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [
        id,
        input.meetingId,
        input.markerType,
        input.timestampSec,
        input.note ?? null,
        new Date().toISOString(),
      ],
    );
    const row = (await db.getFirstAsync<MarkerRow>(
      `SELECT * FROM local_markers WHERE id = ?`,
      [id],
    )) as MarkerRow;
    return fromRow(row);
  },

  async listByMeeting(meetingId: string): Promise<LocalMarker[]> {
    const db = await getDb();
    const rows = (await db.getAllAsync<MarkerRow>(
      `SELECT * FROM local_markers WHERE meeting_id = ? ORDER BY timestamp_sec ASC`,
      [meetingId],
    )) as MarkerRow[];
    return rows.map(fromRow);
  },

  async listPendingSync(): Promise<LocalMarker[]> {
    const db = await getDb();
    const rows = (await db.getAllAsync<MarkerRow>(
      `SELECT * FROM local_markers WHERE sync_status = 'pending'`,
    )) as MarkerRow[];
    return rows.map(fromRow);
  },

  async markSynced(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(`UPDATE local_markers SET sync_status = 'synced' WHERE id = ?`, [id]);
  },
};
