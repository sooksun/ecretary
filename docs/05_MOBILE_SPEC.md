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

### Chunk boundary behaviour (platform difference)

| Platform | Boundary | Audio lost |
|---|---|---|
| Android 8+ | `MediaRecorder.setNextOutputFile()` | None — gapless |
| iOS | Continuous `AVAudioEngine` tap → rotating `AVAssetWriter` | None — gapless |
| iOS (fallback) | AVAudioRecorder stopped and restarted | ~100 ms per boundary |

**iOS is now gapless too.** One continuous input tap feeds a chain of `AVAssetWriter`s; the next chunk's writer is opened a chunk ahead and swapped in under a lock on the audio thread. A tap buffer straddling a boundary is split so chunk durations tile the timeline exactly.

The earlier attempts failed for a reason that had nothing to do with the Simulator or with the hand-built `CMSampleBuffer`: **`AVEncoderBitRateKey = 64000` is out of range for AAC-LC mono at a 16 kHz output rate.** The encoder's own `applicableEncodeBitRates` for 16 kHz mono is {12, 16, 20, 24, 28, 32, 40, 48} kbps. Requesting 64 kbps makes `AVAssetWriter` reject appended buffers with `AVFoundationErrorDomain -11861` / `FigExport -12651`. `AVAudioRecorder` never surfaced this because it silently clamps the requested bit rate — so the documented "64 kbps" was never actually being produced at 16 kHz on either strategy. The module now asks the encoder at runtime and clamps (48 kbps on every runtime measured so far).

AAC priming is not lost audio: encoding N frames and decoding back returns exactly N frames. `AVURLAsset.duration` reads ~132 ms short per chunk because of the priming edit list, but every sample is present — so a boundary costs nothing.

A `diagnostics()` call on the native module reports the encoder's real capabilities and which strategy is active. If the encoder probe at `start()` ever rejects these settings on some runtime, the module falls back to the old AVAudioRecorder rotation automatically, so recording never breaks.

Writing PCM chunks instead would also be gapless but quadruples upload size, which conflicts with the low-bandwidth target in the PRD.

Implementation notes and the exact CoreAudio error codes are recorded in the header comment of
`apps/mobile/modules/m-secretary-recorder/ios/MSecRecorderModule.swift` and in the root `CLAUDE.md`.

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
