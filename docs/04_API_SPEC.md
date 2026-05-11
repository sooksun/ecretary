# 04 REST API Specification

Base URL: `/api/v1`

## Auth

### POST /auth/login

Request

```json
{
  "email": "user@example.com",
  "password": "secret"
}
```

Response

```json
{
  "accessToken": "jwt",
  "user": {
    "id": "uuid",
    "name": "Recorder",
    "role": "admin"
  }
}
```

## Meetings

### POST /meetings

Create meeting.

```json
{
  "title": "ประชุม PLC ป.1-3",
  "meetingType": "plc",
  "location": "ห้องประชุม",
  "agendaText": "ติดตามการอ่านออกเขียนได้",
  "participants": [
    { "name": "ครูสมศรี", "roleLabel": "ครูประจำชั้น" }
  ]
}
```

### GET /meetings

Query:

- status
- from
- to
- q

### GET /meetings/:id

Return meeting detail.

### PATCH /meetings/:id

Update meeting metadata.

### POST /meetings/:id/start

Mark as recording.

### POST /meetings/:id/end

Mark as ended/uploading.

## Audio Chunks

### POST /meetings/:id/audio-chunks

Multipart upload.

Fields:

- file
- clientChunkId
- chunkIndex
- checksumSha256
- durationSec
- startedAtSec
- endedAtSec
- mimeType

Response

```json
{
  "chunkId": "uuid",
  "status": "uploaded",
  "alreadyExists": false
}
```

### GET /meetings/:id/audio-chunks

Return chunk status list.

## Markers

### POST /meetings/:id/markers

```json
{
  "markerType": "decision",
  "timestampSec": 842,
  "note": "เห็นชอบกิจกรรม Open Class"
}
```

### GET /meetings/:id/markers

Return markers.

## Processing

### POST /meetings/:id/process

Start/restart processing.

```json
{
  "force": false
}
```

### GET /meetings/:id/status

```json
{
  "meetingStatus": "processing",
  "chunks": {
    "total": 12,
    "uploaded": 12,
    "transcribed": 8
  },
  "summaryStatus": "pending"
}
```

## Transcript

### GET /meetings/:id/transcript

Return transcript segments.

## Summary

### GET /meetings/:id/summary

Return meeting board.

### POST /meetings/:id/summary/regenerate

Regenerate summary.

```json
{
  "template": "official_school_minutes",
  "notes": "เน้นมติและงานติดตาม"
}
```

## Action Items

### GET /meetings/:id/action-items

### PATCH /action-items/:id

```json
{
  "status": "done",
  "dueDate": "2026-06-10",
  "assigneeName": "ครูสมศรี"
}
```

## Export

### POST /meetings/:id/exports

```json
{
  "exportType": "pdf",
  "template": "thai_official_minutes"
}
```

### GET /meetings/:id/exports

Return export files.

## Notifications Future

### POST /meetings/:id/notify

```json
{
  "channel": "line",
  "messageType": "action_items"
}
```
