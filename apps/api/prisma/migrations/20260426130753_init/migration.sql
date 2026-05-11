-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'RECORDER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('DRAFT', 'RECORDING', 'UPLOADING', 'PROCESSING', 'TRANSCRIBING', 'SUMMARIZING', 'READY', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('GENERAL', 'SCHOOL_ADMIN', 'PLC', 'PROJECT', 'PARENT_MEETING', 'COMMITTEE', 'TRAINING', 'SUPERVISION');

-- CreateEnum
CREATE TYPE "ChunkUploadStatus" AS ENUM ('LOCAL_ONLY', 'QUEUED', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'TRANSCRIBED', 'FAILED_RETRY', 'FAILED_FINAL', 'DONE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "MarkerType" AS ENUM ('IMPORTANT', 'DECISION', 'ACTION', 'ISSUE', 'QUESTION', 'OTHER');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'DONE', 'OVERDUE', 'NEED_CLARIFICATION', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExportType" AS ENUM ('PDF', 'DOCX', 'TRANSCRIPT_TXT');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'RECORDER',
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "meetingType" "MeetingType" NOT NULL DEFAULT 'GENERAL',
    "location" TEXT,
    "agendaText" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingParticipant" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "roleLabel" TEXT,
    "attendanceStatus" TEXT NOT NULL DEFAULT 'present',

    CONSTRAINT "MeetingParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioChunk" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "clientChunkId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT,
    "durationSec" INTEGER,
    "fileSizeBytes" BIGINT,
    "checksumSha256" TEXT,
    "uploadStatus" "ChunkUploadStatus" NOT NULL DEFAULT 'UPLOADED',
    "transcribeStatus" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "startedAtSec" INTEGER,
    "endedAtSec" INTEGER,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedAt" TIMESTAMP(3),

    CONSTRAINT "AudioChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingMarker" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "markerType" "MarkerType" NOT NULL,
    "timestampSec" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingMarker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "audioChunkId" TEXT NOT NULL,
    "startTimeSec" INTEGER NOT NULL,
    "endTimeSec" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "language" TEXT,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingSummary" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "executiveSummary" TEXT NOT NULL,
    "keyPointsJson" JSONB,
    "decisionsJson" JSONB,
    "risksJson" JSONB,
    "pendingQuestionsJson" JSONB,
    "officialMinutesJson" JSONB,
    "qualityCheckJson" JSONB,
    "qualityScore" DOUBLE PRECISION,
    "modelName" TEXT,
    "promptVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeName" TEXT,
    "assigneeUserId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "ActionStatus" NOT NULL DEFAULT 'PENDING',
    "evidenceRequired" TEXT,
    "sourceTimestampSec" INTEGER,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportFile" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "exportType" "ExportType" NOT NULL,
    "filePath" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organizationId_idx" ON "User"("organizationId");

-- CreateIndex
CREATE INDEX "Meeting_organizationId_idx" ON "Meeting"("organizationId");

-- CreateIndex
CREATE INDEX "Meeting_createdById_idx" ON "Meeting"("createdById");

-- CreateIndex
CREATE INDEX "Meeting_status_idx" ON "Meeting"("status");

-- CreateIndex
CREATE INDEX "Meeting_createdAt_idx" ON "Meeting"("createdAt");

-- CreateIndex
CREATE INDEX "MeetingParticipant_meetingId_idx" ON "MeetingParticipant"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "AudioChunk_clientChunkId_key" ON "AudioChunk"("clientChunkId");

-- CreateIndex
CREATE INDEX "AudioChunk_meetingId_idx" ON "AudioChunk"("meetingId");

-- CreateIndex
CREATE INDEX "AudioChunk_transcribeStatus_idx" ON "AudioChunk"("transcribeStatus");

-- CreateIndex
CREATE UNIQUE INDEX "AudioChunk_meetingId_chunkIndex_key" ON "AudioChunk"("meetingId", "chunkIndex");

-- CreateIndex
CREATE INDEX "MeetingMarker_meetingId_timestampSec_idx" ON "MeetingMarker"("meetingId", "timestampSec");

-- CreateIndex
CREATE INDEX "TranscriptSegment_meetingId_startTimeSec_idx" ON "TranscriptSegment"("meetingId", "startTimeSec");

-- CreateIndex
CREATE INDEX "TranscriptSegment_audioChunkId_idx" ON "TranscriptSegment"("audioChunkId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingSummary_meetingId_key" ON "MeetingSummary"("meetingId");

-- CreateIndex
CREATE INDEX "ActionItem_meetingId_idx" ON "ActionItem"("meetingId");

-- CreateIndex
CREATE INDEX "ActionItem_status_idx" ON "ActionItem"("status");

-- CreateIndex
CREATE INDEX "ActionItem_assigneeUserId_idx" ON "ActionItem"("assigneeUserId");

-- CreateIndex
CREATE INDEX "ExportFile_meetingId_idx" ON "ExportFile"("meetingId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingParticipant" ADD CONSTRAINT "MeetingParticipant_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioChunk" ADD CONSTRAINT "AudioChunk_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMarker" ADD CONSTRAINT "MeetingMarker_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingMarker" ADD CONSTRAINT "MeetingMarker_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_audioChunkId_fkey" FOREIGN KEY ("audioChunkId") REFERENCES "AudioChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingSummary" ADD CONSTRAINT "MeetingSummary_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportFile" ADD CONSTRAINT "ExportFile_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportFile" ADD CONSTRAINT "ExportFile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
