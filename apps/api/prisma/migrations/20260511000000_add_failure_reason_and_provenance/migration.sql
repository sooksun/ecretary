-- AlterTable: surface why a meeting reached FAILED state
ALTER TABLE "Meeting" ADD COLUMN "failureReason" TEXT;

-- AlterTable: record which provider produced the transcript for each chunk
-- (e.g. "whisper:medium", "mock") so we can audit silent-fallback regressions
ALTER TABLE "AudioChunk" ADD COLUMN "transcribeProvider" TEXT;
