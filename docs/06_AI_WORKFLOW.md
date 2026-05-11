# 06 AI Workflow

## AI Pipeline

```txt
Uploaded Audio Chunk
  → Validate audio
  → Optional ffmpeg normalize/resample
  → faster-whisper transcription
  → Transcript segment storage
  → Merge transcript by timestamp
  → Apply meeting type prompt
  → Generate meeting board
  → Quality check
  → Save summary/action items
```

## Transcription Requirements

- Thai first
- Mixed Thai-English supported
- Preserve timestamps
- Allow chunk-level retry
- Store raw transcript and cleaned transcript separately if possible

## Summary Output Schema

```json
{
  "executiveSummary": "string",
  "keyPoints": [
    {
      "title": "string",
      "detail": "string",
      "confidence": 0.0,
      "sourceTimestampSec": 0
    }
  ],
  "decisions": [
    {
      "decision": "string",
      "rationale": "string",
      "confidence": 0.0,
      "sourceTimestampSec": 0
    }
  ],
  "actionItems": [
    {
      "title": "string",
      "description": "string",
      "assigneeName": "string|null",
      "dueDate": "YYYY-MM-DD|null",
      "evidenceRequired": "string|null",
      "confidence": 0.0,
      "sourceTimestampSec": 0
    }
  ],
  "risks": [
    {
      "risk": "string",
      "impact": "string",
      "recommendation": "string",
      "confidence": 0.0
    }
  ],
  "pendingQuestions": [
    {
      "question": "string",
      "owner": "string|null",
      "confidence": 0.0
    }
  ],
  "officialMinutes": {
    "title": "string",
    "dateText": "string",
    "location": "string",
    "attendees": ["string"],
    "absentees": ["string"],
    "agendaItems": [
      {
        "agendaNo": "string",
        "topic": "string",
        "discussion": "string",
        "resolution": "string"
      }
    ],
    "closedAt": "string|null",
    "minuteTaker": "string|null",
    "reviewer": "string|null"
  },
  "qualityCheck": {
    "missingFields": ["string"],
    "uncertainItems": ["string"],
    "recommendations": ["string"]
  }
}
```

## Meeting Type Templates

### General/Admin Meeting

Focus:

- summary
- decisions
- action items
- risks
- follow-up

### PLC Meeting

Focus:

- student learning problem
- evidence discussed
- teaching strategy
- peer reflection
- next instructional adjustment
- follow-up evidence

### Project Meeting

Focus:

- progress
- blockers
- budget/resources
- decisions
- next tasks
- timeline risks

### School Official Meeting

Focus:

- official agenda
- resolution wording
- formal minutes
- attendees/absentees
- action items

## Quality Check Rules

Flag if:

- no decisions found but meeting type implies decisions
- action item has no assignee
- action item has no due date
- official minutes missing attendees
- transcript too short relative to meeting duration
- too many low-confidence items

## Worker States

```txt
pending
processing
completed
failed
needs_review
```

## Error Handling

- If one chunk fails, mark chunk failed but continue other chunks
- Allow reprocess chunk
- Allow regenerate summary without retranscribing
- Store model name and prompt version for audit
