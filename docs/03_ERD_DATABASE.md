# 03 ERD + Database Design

## Entity Overview

```txt
Organization 1---n User
Organization 1---n Meeting
Meeting 1---n MeetingParticipant
Meeting 1---n AudioChunk
Meeting 1---n MeetingMarker
Meeting 1---n TranscriptSegment
Meeting 1---1 MeetingSummary
Meeting 1---n ActionItem
Meeting 1---n ExportFile
AudioChunk 1---n TranscriptSegment
```

## Tables

### organizations

| Field | Type | Note |
|---|---|---|
| id | uuid | PK |
| name | varchar | organization name |
| type | varchar | school, office, project |
| created_at | datetime |  |
| updated_at | datetime |  |

### users

| Field | Type | Note |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK |
| name | varchar |  |
| email | varchar | nullable |
| phone | varchar | nullable |
| role | varchar | admin, recorder, viewer |
| created_at | datetime |  |
| updated_at | datetime |  |

### meetings

| Field | Type | Note |
|---|---|---|
| id | uuid | PK |
| organization_id | uuid | FK |
| created_by_id | uuid | FK users |
| title | varchar |  |
| meeting_type | varchar | plc, admin, project, general |
| location | varchar | nullable |
| agenda_text | text | nullable |
| status | varchar | draft, recording, uploading, processing, completed, failed |
| started_at | datetime | nullable |
| ended_at | datetime | nullable |
| created_at | datetime |  |
| updated_at | datetime |  |

### meeting_participants

| Field | Type | Note |
|---|---|---|
| id | uuid | PK |
| meeting_id | uuid | FK |
| user_id | uuid | nullable |
| name | varchar |  |
| role_label | varchar | nullable |
| attendance_status | varchar | present, absent, guest |

### audio_chunks

| Field | Type | Note |
|---|---|---|
| id | uuid | PK |
| meeting_id | uuid | FK |
| client_chunk_id | varchar | unique per device |
| chunk_index | int | 0,1,2... |
| file_path | text | storage path |
| mime_type | varchar | audio/mp4, audio/m4a |
| duration_sec | int |  |
| file_size_bytes | bigint |  |
| checksum_sha256 | varchar |  |
| upload_status | varchar | local, queued, uploading, uploaded, failed |
| transcribe_status | varchar | pending, processing, completed, failed |
| started_at_sec | int | relative meeting timestamp |
| ended_at_sec | int | relative meeting timestamp |
| created_at | datetime |  |
| uploaded_at | datetime | nullable |

### meeting_markers

| Field | Type | Note |
|---|---|---|
| id | uuid | PK |
| meeting_id | uuid | FK |
| marker_type | varchar | important, decision, action, issue, question |
| timestamp_sec | int | relative timestamp |
| note | text | nullable |
| created_by_id | uuid | FK users nullable |
| created_at | datetime |  |

### transcript_segments

| Field | Type | Note |
|---|---|---|
| id | uuid | PK |
| meeting_id | uuid | FK |
| audio_chunk_id | uuid | FK |
| start_time_sec | int |  |
| end_time_sec | int |  |
| text | text |  |
| language | varchar | th, en, mixed |
| confidence | float | nullable |
| created_at | datetime |  |

### meeting_summaries

| Field | Type | Note |
|---|---|---|
| id | uuid | PK |
| meeting_id | uuid | unique FK |
| executive_summary | text |  |
| key_points_json | json |  |
| decisions_json | json |  |
| risks_json | json |  |
| pending_questions_json | json |  |
| official_minutes_json | json | structured official report |
| quality_score | float | nullable |
| model_name | varchar | nullable |
| created_at | datetime |  |
| updated_at | datetime |  |

### action_items

| Field | Type | Note |
|---|---|---|
| id | uuid | PK |
| meeting_id | uuid | FK |
| title | varchar |  |
| description | text | nullable |
| assignee_name | varchar | nullable |
| assignee_user_id | uuid | nullable |
| due_date | date | nullable |
| status | varchar | pending, in_progress, done, overdue, need_clarification |
| evidence_required | text | nullable |
| source_timestamp_sec | int | nullable |
| confidence | float | nullable |
| created_at | datetime |  |
| updated_at | datetime |  |

### export_files

| Field | Type | Note |
|---|---|---|
| id | uuid | PK |
| meeting_id | uuid | FK |
| export_type | varchar | pdf, docx, transcript_txt |
| file_path | text |  |
| created_by_id | uuid | nullable |
| created_at | datetime |  |

## Indexes

- meetings.organization_id
- meetings.created_by_id
- meetings.status
- audio_chunks.meeting_id + chunk_index unique
- audio_chunks.client_chunk_id unique
- transcript_segments.meeting_id
- action_items.meeting_id
- action_items.status
- meeting_markers.meeting_id + timestamp_sec
