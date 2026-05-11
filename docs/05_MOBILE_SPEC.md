# 05 Mobile App Implementation Spec

## Recommended Stack

- React Native
- Expo Dev Client
- TypeScript
- SQLite for relational local data
- MMKV for fast key-value settings
- expo-file-system for file management
- expo-av or native recorder module for audio
- NetInfo for connectivity
- React Query for API state
- Zustand for simple app state

## App Screens

### 1. Home Screen

Shows:

- Start new meeting
- Recent meetings
- Pending uploads
- Pending action items
- Storage warning

### 2. New Meeting Screen

Fields:

- title
- meeting type
- location
- agenda
- participants

### 3. Recording Screen

Main controls:

- Start/Pause/Resume/Stop
- Timer
- Current chunk number
- Mic level
- Battery level
- Storage available
- Network status
- Upload progress

Marker buttons:

- Important
- Decision
- Action
- Issue
- Question

### 4. Processing Screen

Shows:

- uploaded chunks / total chunks
- transcribed chunks / total chunks
- summary status
- retry failed uploads

### 5. Meeting Board Screen

Tabs/cards:

- Summary
- Decisions
- Action Items
- Risks
- Pending Questions
- Transcript
- Export

### 6. Action Tracker Screen

Filters:

- All
- Pending
- Overdue
- Done

## Local SQLite Tables

### local_meetings

```sql
CREATE TABLE local_meetings (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  title TEXT NOT NULL,
  meeting_type TEXT,
  location TEXT,
  agenda_text TEXT,
  status TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### local_audio_chunks

```sql
CREATE TABLE local_audio_chunks (
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
  created_at TEXT NOT NULL,
  uploaded_at TEXT
);
```

### local_markers

```sql
CREATE TABLE local_markers (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL,
  marker_type TEXT NOT NULL,
  timestamp_sec INTEGER NOT NULL,
  note TEXT,
  sync_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## Recording Rules

- Default chunk length: 5 minutes
- Use M4A/AAC where supported
- Use mono if supported
- Prefer 16kHz or lowest stable quality acceptable for transcription
- Never keep entire audio in memory
- Always persist chunk metadata immediately after a chunk starts and after it stops

## Upload Queue Rules

- Upload only chunks with status `queued` or `failed_retry`
- Use exponential backoff
- Pause upload on low battery if user setting enabled
- Resume upload on Wi-Fi if user setting requires Wi-Fi
- Verify checksum where possible
- Do not delete local file until server confirms upload and backup policy allows deletion

## Crash Recovery

On app start:

1. Scan local DB for `recording` meetings
2. Scan file directory for orphan chunks
3. Mark incomplete chunk as recoverable/failed
4. Ask user whether to continue or end meeting
5. Queue completed chunks for upload

## Mobile Services

```txt
AudioRecorderService
ChunkManagerService
UploadQueueService
NetworkService
BatteryStorageMonitor
MarkerService
MeetingSyncService
ResultSyncService
```

## Important UX Details

- Show big red/green recording status
- Warn when mic permission denied
- Warn when storage < 1 GB
- Warn when battery < 20%
- Let user continue recording even if network offline
- Show clear message: "เสียงถูกบันทึกในเครื่องแล้ว รอส่งขึ้นระบบเมื่อมีอินเทอร์เน็ต"
