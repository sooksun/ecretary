/**
 * Deterministic BullMQ job IDs.
 *
 * Both the API and the worker enqueue the same logical jobs (a re-uploaded
 * chunk, a summary re-triggered by the sweep). BullMQ deduplicates on jobId,
 * so deriving the id from the domain row keeps those paths idempotent — the
 * same chunk never queues two transcribe jobs, and a meeting never queues two
 * summaries.
 *
 * Separator is `-`, not `:` — BullMQ rejects custom job IDs containing a colon
 * ("Custom Id cannot contain :") because it namespaces its own Redis keys with it.
 */
export const jobId = {
  transcribe: (chunkId: string) => `transcribe-${chunkId}`,
  summarize: (meetingId: string) => `summarize-${meetingId}`,
} as const;
