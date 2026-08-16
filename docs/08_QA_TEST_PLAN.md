# 08 QA and Test Plan

## Test Philosophy

The app must be boringly reliable. A meeting recorder that loses audio is not a product; it is a small electronic prank.

## Mobile Test Cases

### Recording

| Case | Expected |
|---|---|
| Record 10 minutes | 2 chunks if chunk length = 5 min |
| Record 60 minutes | 12 chunks, no crash |
| Speech across a chunk boundary (iOS) | Android: nothing lost. **iOS: ~100 ms clipped at each boundary — expected, not a defect.** Fail only if audible loss is longer than that or a whole phrase disappears. See 05_MOBILE_SPEC "Chunk boundary behaviour". |
| Pause/resume | timestamps remain consistent |
| Stop recording | meeting status changes to uploading/local_done |
| App killed mid-recording | completed chunks remain recoverable |
| Storage low | warning shown before failure |
| Mic permission denied | clear permission UI shown |

### Upload

| Case | Expected |
|---|---|
| Network offline | chunks remain queued |
| Network returns | upload resumes |
| Server returns 500 | retry with backoff |
| Duplicate retry | server returns alreadyExists true |
| Checksum mismatch | chunk marked failed |

### Markers

| Case | Expected |
|---|---|
| Add decision marker | marker saved with timestamp |
| Add action marker offline | sync later |
| Marker during pause | either blocked or timestamp handled clearly |

## Backend Test Cases

### API

- Create meeting
- Upload chunk
- Duplicate chunk upload
- Fetch status
- Fetch transcript
- Fetch summary
- Patch action item

### Worker

- Job created after upload
- Job retry on failure
- Transcript saved
- Summary created after transcript complete
- Summary regeneration does not duplicate action items unless intended

## AI Evaluation

Use real meeting samples and score:

| Dimension | Score 1–5 |
|---|---|
| Thai transcription readability |  |
| Key point extraction |  |
| Decision accuracy |  |
| Action item accuracy |  |
| Assignee extraction |  |
| Due date extraction |  |
| Official report usability |  |

## Device Test Matrix

Minimum recommended:

- Android 10 device with 3–4GB RAM
- Android 12 device with 4GB RAM
- Android 14 device modern phone
- iPhone recent device for compatibility after Android MVP

## Field Test Protocol

1. Ask consent before recording
2. Use real 30–60 min meeting
3. Compare human notes vs AI output
4. Collect edits required by secretary
5. Record device heat/battery/storage/network issues
6. Improve prompt and workflow

## Performance Targets

- Recording CPU low enough for old Android
- 60-minute meeting must not crash
- Chunk upload retry success > 95%
- Summary available after transcription completes
- Local DB must not corrupt after forced close
