import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('msecretary.db');
  await migrate(db);
  return db;
}

async function migrate(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS local_meetings (
      id TEXT PRIMARY KEY,
      server_id TEXT,
      title TEXT NOT NULL,
      meeting_type TEXT NOT NULL,
      location TEXT,
      agenda_text TEXT,
      status TEXT NOT NULL,
      started_at TEXT,
      ended_at TEXT,
      pending_sync TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_audio_chunks (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      server_id TEXT,
      client_chunk_id TEXT NOT NULL UNIQUE,
      chunk_index INTEGER NOT NULL,
      file_uri TEXT NOT NULL,
      checksum_sha256 TEXT,
      duration_sec INTEGER,
      file_size_bytes INTEGER,
      upload_status TEXT NOT NULL,
      started_at_sec INTEGER,
      ended_at_sec INTEGER,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      uploaded_at TEXT,
      FOREIGN KEY (meeting_id) REFERENCES local_meetings(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_meeting ON local_audio_chunks(meeting_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_status  ON local_audio_chunks(upload_status);

    CREATE TABLE IF NOT EXISTS local_markers (
      id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL,
      marker_type TEXT NOT NULL,
      timestamp_sec INTEGER NOT NULL,
      note TEXT,
      sync_status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      FOREIGN KEY (meeting_id) REFERENCES local_meetings(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_markers_meeting ON local_markers(meeting_id);

    CREATE TABLE IF NOT EXISTS local_upload_queue (
      id TEXT PRIMARY KEY,
      chunk_id TEXT NOT NULL UNIQUE,
      next_attempt_at TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      FOREIGN KEY (chunk_id) REFERENCES local_audio_chunks(id) ON DELETE CASCADE
    );
  `);

  // v2: add pending_sync to local_meetings (no-op for fresh installs where column already exists)
  const row = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if ((row?.user_version ?? 0) < 2) {
    try {
      await database.execAsync('ALTER TABLE local_meetings ADD COLUMN pending_sync TEXT');
    } catch {
      // column already present in fresh-install schema — safe to ignore
    }
    await database.execAsync('PRAGMA user_version = 2');
  }
}
