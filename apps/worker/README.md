# @msec/worker — BullMQ consumer

Runs two queues:

| Queue | Job | Provider |
|---|---|---|
| `transcribe` | `transcribe-chunk` | `MockTranscriptionProvider` (Phase A) |
| `summarize` | `summarize-meeting` | `MockSummarizationProvider` (Phase A) |

When every chunk for a meeting reaches `COMPLETED`, the transcribe handler
enqueues a single summary job. The summary handler upserts `MeetingSummary`,
inserts AI-extracted `ActionItem` rows, and flips the meeting to `READY`.

## Run

```bash
# requires Redis + Postgres up (docker compose)
npm --workspace @msec/api exec -- prisma generate
npm run dev:worker
```

## Swap in real AI

1. Implement another `TranscriptionProvider` in `src/ai/transcription.ts`
   (e.g. spawn faster-whisper subprocess, call HTTP service, etc.).
2. Implement another `SummarizationProvider` in `src/ai/summarization.ts`
   (build prompt → call LLM → `SummaryOutputSchema.parse(json)` → fall
   back to mock on parse failure).
3. Switch via `AI_PROVIDER` env var.

The mock provider is intentionally deterministic so QA can assert on the
shape of the meeting board.
