-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "totalChunks" INTEGER;

-- CreateIndex
CREATE INDEX "AudioChunk_meetingId_transcribeStatus_idx" ON "AudioChunk"("meetingId", "transcribeStatus");

-- CreateIndex
CREATE INDEX "AudioChunk_meetingId_uploadStatus_idx" ON "AudioChunk"("meetingId", "uploadStatus");

-- CreateIndex
CREATE INDEX "Meeting_organizationId_createdAt_idx" ON "Meeting"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Meeting_status_createdAt_idx" ON "Meeting"("status", "createdAt");
