// MUST stay first — populates process.env before any sibling import is
// evaluated. Do NOT add imports above this line. See loadEnv.ts for why.
import './loadEnv';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { QueueName } from '@msec/shared';
import { MeetingStatus as PrismaMeetingStatus } from '@prisma/client';
import { config } from './config';
import { logger } from './logger';
import { runPreflight } from './preflight';
import { handleTranscribeJob, TranscribeJobData } from './jobs/transcribe';
import { handleSummarizeJob, SummarizeJobData } from './jobs/summarize';
import { prisma } from './prisma';
import { redactSecrets } from './redactSecrets';
import { alertMeetingFailed } from './alertWebhook';

async function bootstrap(): Promise<void> {
  // Refuse to start if config selects a real provider but it's unreachable
  // or misconfigured. See preflight.ts — this replaces the silent fallback.
  const pre = await runPreflight();
  logger.info(pre, '🔎 preflight ok');

  const connection = new IORedis(config.redis.port, config.redis.host, {
    maxRetriesPerRequest: null,
  });

  // shared queue handle so transcribe handler can enqueue summary
  const summarizeQueue = new Queue<SummarizeJobData>(QueueName.SUMMARIZE, { connection });

  const transcribeWorker = new Worker<TranscribeJobData>(
    QueueName.TRANSCRIBE,
    (job) => handleTranscribeJob(job, summarizeQueue),
    {
      connection,
      concurrency: config.concurrency.transcribe,
    },
  );

  const summarizeWorker = new Worker<SummarizeJobData>(
    QueueName.SUMMARIZE,
    (job) => handleSummarizeJob(job),
    {
      connection,
      concurrency: config.concurrency.summary,
    },
  );

  for (const w of [transcribeWorker, summarizeWorker]) {
    w.on('completed', (job) => logger.info({ queue: w.name, jobId: job.id }, 'job.completed'));
    w.on('failed', (job, err) => {
      logger.error(
        {
          queue: w.name,
          jobId: job?.id,
          attemptsMade: job?.attemptsMade,
          maxAttempts: job?.opts.attempts,
          err: err.message,
        },
        'job.failed',
      );
      // Only mark meeting FAILED on the FINAL attempt — earlier attempts will
      // be retried by BullMQ and may still succeed.
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        const meetingId = (job.data as { meetingId?: string } | undefined)?.meetingId;
        if (meetingId) {
          void markMeetingFailed(meetingId, w.name, err.message);
        }
      }
    });
  }

  logger.info(
    {
      aiProvider: config.aiProvider,
      llmProvider: config.llmProvider,
      llmModel: config.llmModel,
      whisperEndpoint: pre.whisperEndpoint,
      transcribeConcurrency: config.concurrency.transcribe,
      summaryConcurrency: config.concurrency.summary,
    },
    '🟢 Worker ready',
  );

  const shutdown = async (signal: string) => {
    logger.warn({ signal }, 'shutdown.start');
    await transcribeWorker.close();
    await summarizeWorker.close();
    await summarizeQueue.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// Statuses we will NOT overwrite with FAILED. READY and ARCHIVED are
// terminal-success; FAILED is already terminal. A late-arriving 'failed'
// event from a stale retry must not regress a meeting that has since
// completed (e.g. another chunk's job kept retrying after summarize already
// ran on the chunks that did succeed).
const TERMINAL_STATUSES = [
  PrismaMeetingStatus.READY,
  PrismaMeetingStatus.ARCHIVED,
  PrismaMeetingStatus.FAILED,
];

async function markMeetingFailed(
  meetingId: string,
  queue: string,
  reason: string,
): Promise<void> {
  try {
    // Redact BEFORE slicing — a 100-char API key in the first chars of the
    // error message would otherwise survive the truncation. The mobile UI
    // shows this string verbatim to any logged-in user of the org, so it
    // must not contain anything credential-shaped.
    const safeReason = redactSecrets(`[${queue}] ${reason}`).slice(0, 500);
    const { count } = await prisma.meeting.updateMany({
      where: { id: meetingId, status: { notIn: TERMINAL_STATUSES } },
      data: {
        status: PrismaMeetingStatus.FAILED,
        failureReason: safeReason,
      },
    });
    if (count === 0) {
      logger.warn(
        { meetingId, queue, reason },
        'meeting.markFailed.skippedTerminal',
      );
      return;
    }
    logger.warn({ meetingId, queue, reason }, 'meeting.markedFailed');
    // Fire-and-forget — alert delivery must not block (or fail) the
    // primary failure-handling path. See alertWebhook.ts.
    void alertMeetingFailed({ meetingId, queue, reason });
  } catch (err) {
    logger.error(
      { meetingId, err: (err as Error).message },
      'meeting.markFailed.dbError',
    );
  }
}

bootstrap().catch((err) => {
  logger.error({ err: (err as Error).message }, 'worker.bootstrapFailed');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'worker.unhandledRejection');
});
