# 07 Development Roadmap

## Phase 1 — Reliable Recording MVP

Duration: 2–3 weeks

Deliverables:

- React Native app scaffold
- New meeting screen
- Recording screen
- Audio recording to local file
- Chunk every 5 minutes
- Local SQLite metadata
- Basic file playback
- Storage/battery/network status

Acceptance Criteria:

- Record 60-minute meeting without crash
- Files split correctly
- Metadata saved for every chunk
- App restart can recover existing chunks

## Phase 2 — Upload & Backend MVP

Duration: 2–3 weeks

Deliverables:

- NestJS scaffold
- Auth stub
- Meeting API
- Chunk upload API
- MinIO/S3 storage
- Upload queue on mobile
- Retry failed upload
- Chunk status page

Acceptance Criteria:

- Mobile uploads chunks to server
- Retry works after network disconnect
- Duplicate upload does not duplicate chunk
- Server validates checksum

## Phase 3 — Transcription Worker

Duration: 2–4 weeks

Deliverables:

- Redis + BullMQ
- Transcription job creation
- faster-whisper worker
- Transcript segment storage
- Transcript merge API

Acceptance Criteria:

- Uploaded chunks are transcribed
- Transcript segments have timestamps
- Failed jobs can retry
- Meeting transcript can be fetched

## Phase 4 — AI Summary & Meeting Board

Duration: 2–3 weeks

Deliverables:

- Summary prompt templates
- Summary worker
- Meeting board API
- Mobile Meeting Board UI
- Action item extraction
- Risk/pending question extraction

Acceptance Criteria:

- Summary generated from transcript
- Decisions and action items extracted
- User can edit action item status
- Quality check flags missing info

## Phase 5 — Official Export

Duration: 2–3 weeks

Deliverables:

- Official minutes data mapping
- PDF export service
- DOCX export service
- Share/export UI

Acceptance Criteria:

- User can export official meeting minutes
- Thai text renders correctly
- Export includes title/date/location/attendees/agenda/resolutions

## Phase 6 — LINE/Notification Integration

Duration: 2–4 weeks

Deliverables:

- Notification API
- LINE push integration-ready service
- Action item reminder
- Meeting summary share

Acceptance Criteria:

- Action items can be sent to configured channel/user
- Reminder format is readable
- No sensitive data sent without confirmation

## MVP Cut Line

For first field test, stop after Phase 4.

Field test goal:

- record real school meetings
- transcribe Thai audio
- produce usable meeting board
- validate whether official export needs custom templates
