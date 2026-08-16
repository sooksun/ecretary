import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { jobId } from '@msec/shared';
import { TERMINAL_OR_LATER_STATUSES } from '../meetingConstants';
import { JobStatus as PrismaJobStatus, ChunkUploadStatus as PrismaChunkStatus, MeetingStatus as PrismaMeetingStatus } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { MockTranscriptionProvider, TranscriptionProvider } from '../ai/transcription';
import { WhisperHttpProvider } from '../ai/whisper-provider';
import { config } from '../config';

export interface TranscribeJobData {
  chunkId: string;
  meetingId: string;
  key: string;
}

let provider: TranscriptionProvider | null = null;
function getProvider(): TranscriptionProvider {
  if (provider) return provider;
  switch (config.aiProvider) {
    case 'whisper':
      logger.info({ endpoint: config.whisperEndpoint }, 'transcribe.provider=whisper');
      provider = new WhisperHttpProvider();
      break;
    case 'mock':
    default:
      logger.info({}, 'transcribe.provider=mock');
      provider = new MockTranscriptionProvider();
      break;
  }
  return provider;
}

export async function handleTranscribeJob(
  job: Job<TranscribeJobData>,
  summarizeQueue: Queue,
): Promise<void> {
  const { chunkId, meetingId } = job.data;
  logger.info({ chunkId, meetingId }, 'transcribe.start');

  const chunk = await prisma.audioChunk.findUnique({ where: { id: chunkId } });
  if (!chunk) {
    logger.warn({ chunkId }, 'transcribe.chunkNotFound');
    return;
  }

  await prisma.audioChunk.update({
    where: { id: chunkId },
    data: {
      transcribeStatus: PrismaJobStatus.PROCESSING,
      uploadStatus: PrismaChunkStatus.PROCESSING,
    },
  });

  // Guard against regressing a meeting that already reached a terminal/later
  // state (READY, FAILED, ARCHIVED, SUMMARIZING). A stale BullMQ retry or a
  // forceProcess re-enqueue must not flip a finished meeting back to
  // TRANSCRIBING. If count===0 the meeting has progressed — skip this chunk.
  const { count: resetCount } = await prisma.meeting.updateMany({
    where: { id: meetingId, status: { notIn: TERMINAL_OR_LATER_STATUSES } },
    data: { status: PrismaMeetingStatus.TRANSCRIBING, failureReason: null },
  });
  if (resetCount === 0) {
    logger.warn({ chunkId, meetingId }, 'transcribe.skipped: meeting already in terminal/later state');
    return;
  }

  try {
    const p = getProvider();
    const segments = await p.transcribe({
      chunkId,
      chunkIndex: chunk.chunkIndex,
      durationSec: chunk.durationSec ?? 300,
      filePath: chunk.filePath,
      mimeType: chunk.mimeType,
    });

    const baseOffset = chunk.startedAtSec ?? chunk.chunkIndex * 300;
    await prisma.$transaction(async (tx) => {
      // Wipe any segments from a previous attempt before inserting fresh ones.
      // This makes retries idempotent: a partial insert from a prior failed attempt
      // cannot produce duplicate rows.
      await tx.transcriptSegment.deleteMany({ where: { audioChunkId: chunkId } });
      await tx.transcriptSegment.createMany({
        data: segments.map((seg) => ({
          meetingId,
          audioChunkId: chunkId,
          startTimeSec: baseOffset + Math.floor(seg.start),
          endTimeSec: baseOffset + Math.floor(seg.end),
          text: seg.text,
          language: seg.language,
          confidence: seg.confidence,
        })),
      });
    });

    await prisma.audioChunk.update({
      where: { id: chunkId },
      data: {
        transcribeStatus: PrismaJobStatus.COMPLETED,
        uploadStatus: PrismaChunkStatus.TRANSCRIBED,
        transcribeProvider: p.providerName,
        lastError: null,
      },
    });

    logger.info(
      { chunkId, segments: segments.length, provider: p.providerName },
      'transcribe.done',
    );

    // Trigger summary if every chunk for this meeting is done
    await maybeQueueSummary(meetingId, summarizeQueue);
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ chunkId, err: message }, 'transcribe.failed');
    await prisma.audioChunk.update({
      where: { id: chunkId },
      data: {
        transcribeStatus: PrismaJobStatus.FAILED,
        uploadStatus: PrismaChunkStatus.FAILED_RETRY,
        retryCount: { increment: 1 },
        lastError: message,
      },
    });
    throw err;
  }
}

async function maybeQueueSummary(meetingId: string, summarizeQueue: Queue): Promise<void> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { status: true, endedAt: true, totalChunks: true },
  });

  if (!meeting || !meeting.endedAt || meeting.totalChunks === null) {
    return;
  }

  const counts = await prisma.audioChunk.groupBy({
    by: ['transcribeStatus'],
    where: { meetingId },
    _count: { _all: true },
  });
  const completed = counts.find((c) => c.transcribeStatus === PrismaJobStatus.COMPLETED)?._count._all ?? 0;
  if (completed < meeting.totalChunks) return;

  // Atomic TRANSCRIBING/UPLOADING → SUMMARIZING transition.
  // Only the worker that successfully flips the status enqueues the job.
  // If a concurrent worker already flipped (count === 0), this worker exits quietly
  // — no duplicate summarize job is queued.
  const { count } = await prisma.meeting.updateMany({
    where: { id: meetingId, status: { in: [PrismaMeetingStatus.TRANSCRIBING, PrismaMeetingStatus.UPLOADING] } },
    data: { status: PrismaMeetingStatus.SUMMARIZING },
  });
  if (count === 0) return;

  await summarizeQueue.add(
    'summarize-meeting',
    { meetingId },
    {
      jobId: jobId.summarize(meetingId),
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
  logger.info({ meetingId }, 'transcribe.queuedSummary');
}
