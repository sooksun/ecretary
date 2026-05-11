import type { Job } from 'bullmq';
import { Queue } from 'bullmq';
import { JobStatus, ChunkUploadStatus, MeetingStatus, QueueName } from '@msec/shared';
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

  // Reset failureReason whenever a chunk starts processing — a retry after
  // infra was fixed must not leave a stale "whisper unreachable" reason on a
  // meeting that successfully completes this attempt.
  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: PrismaMeetingStatus.TRANSCRIBING, failureReason: null },
  });

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
  const counts = await prisma.audioChunk.groupBy({
    by: ['transcribeStatus'],
    where: { meetingId },
    _count: { _all: true },
  });
  const total = counts.reduce((acc, c) => acc + c._count._all, 0);
  const completed = counts.find((c) => c.transcribeStatus === PrismaJobStatus.COMPLETED)?._count._all ?? 0;
  if (total === 0 || completed !== total) return;

  // Atomic TRANSCRIBING → SUMMARIZING transition.
  // Only the worker that successfully flips the status enqueues the job.
  // If a concurrent worker already flipped (count === 0), this worker exits quietly
  // — no duplicate summarize job is queued.
  const { count } = await prisma.meeting.updateMany({
    where: { id: meetingId, status: PrismaMeetingStatus.TRANSCRIBING },
    data: { status: PrismaMeetingStatus.SUMMARIZING },
  });
  if (count === 0) return;

  await summarizeQueue.add(
    'summarize-meeting',
    { meetingId },
    { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 100, removeOnFail: 100 },
  );
  logger.info({ meetingId }, 'transcribe.queuedSummary');
}
