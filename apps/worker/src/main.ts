// MUST stay first — populates process.env before any sibling import is
// evaluated. Do NOT add imports above this line. See loadEnv.ts for why.
import './loadEnv';
import { createServer } from 'http';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { QueueName, jobId } from '@msec/shared';
import { MeetingStatus as PrismaMeetingStatus, JobStatus as PrismaJobStatus } from '@prisma/client';
import { TERMINAL_STATUSES } from './meetingConstants';
import { config } from './config';
import { logger } from './logger';
import { runPreflight } from './preflight';
import { handleTranscribeJob, TranscribeJobData } from './jobs/transcribe';
import { handleSummarizeJob, SummarizeJobData } from './jobs/summarize';
import { handleSweepJob } from './jobs/sweep';
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
  const transcribeQueue = new Queue<TranscribeJobData>(QueueName.TRANSCRIBE, { connection });

  // Sweep queue: runs a repeatable job every 15 min to detect stuck meetings.
  const sweepQueue = new Queue(QueueName.SWEEP, { connection });
  const SWEEP_INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS ?? 15 * 60 * 1000);
  await sweepQueue.upsertJobScheduler('sweep-stuck-meetings', { every: SWEEP_INTERVAL_MS });

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

  const sweepWorker = new Worker(
    QueueName.SWEEP,
    () => handleSweepJob(),
    { connection, concurrency: 1 },
  );

  for (const w of [transcribeWorker, summarizeWorker, sweepWorker]) {
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
          if (w.name === QueueName.TRANSCRIBE) {
            // For transcribe failures: if sibling chunks already completed, attempt
            // a partial summary rather than marking the whole meeting FAILED.
            void tryPartialSummarizeOrFail(meetingId, w.name, err.message, summarizeQueue);
          } else {
            void markMeetingFailed(meetingId, w.name, err.message);
          }
        }
      }
    });
  }

  // ── Health endpoint ──────────────────────────────────────────────────
  const WORKER_HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 3001);

  const healthServer = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'GET') {
        res.writeHead(405);
        res.end();
        return;
      }
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      if (req.url === '/metrics/queues') {
        try {
          const [tWaiting, tActive, sWaiting, sActive] = await Promise.all([
            transcribeQueue.getWaitingCount(),
            transcribeQueue.getActiveCount(),
            summarizeQueue.getWaitingCount(),
            summarizeQueue.getActiveCount(),
          ]);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            transcribe: { waiting: tWaiting, active: tActive },
            summarize: { waiting: sWaiting, active: sActive },
          }));
        } catch {
          res.writeHead(500);
          res.end();
        }
        return;
      }
      res.writeHead(404);
      res.end();
    })();
  });

  healthServer.listen(WORKER_HEALTH_PORT, () => {
    logger.info({ port: WORKER_HEALTH_PORT }, '🏥 health server listening');
  });

  logger.info(
    {
      aiProvider: config.aiProvider,
      llmProvider: config.llmProvider,
      llmModel: config.llmModel,
      whisperEndpoint: pre.whisperEndpoint,
      transcribeConcurrency: config.concurrency.transcribe,
      summaryConcurrency: config.concurrency.summary,
      healthPort: WORKER_HEALTH_PORT,
    },
    '🟢 Worker ready',
  );

  const shutdown = async (signal: string) => {
    logger.warn({ signal }, 'shutdown.start');
    await transcribeWorker.close();
    await summarizeWorker.close();
    await sweepWorker.close();
    await summarizeQueue.close();
    await sweepQueue.close();
    await transcribeQueue.close();
    await connection.quit();
    await prisma.$disconnect();
    await new Promise<void>((resolve) => healthServer.close(() => resolve()));
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

async function tryPartialSummarizeOrFail(
  meetingId: string,
  queue: string,
  reason: string,
  summarizeQueue: Queue,
): Promise<void> {
  try {
    const counts = await prisma.audioChunk.groupBy({
      by: ['transcribeStatus'],
      where: { meetingId },
      _count: { _all: true },
    });
    const completed =
      counts.find((c) => c.transcribeStatus === PrismaJobStatus.COMPLETED)?._count._all ?? 0;
    const total = counts.reduce((acc, c) => acc + c._count._all, 0);

    if (completed > 0) {
      // At least one chunk transcribed — produce a partial summary with a coverage warning.
      const coverage = `${completed}/${total}`;
      // Enqueue BEFORE the status flip: if add() throws the meeting stays in
      // its current state and markMeetingFailed below can still transition it
      // to FAILED cleanly. If add() succeeds but updateMany fails the job runs
      // anyway and the summarize handler sets the meeting to READY.
      await summarizeQueue.add(
        'summarize-meeting',
        {
          meetingId,
          notes: `⚠️ transcript บางส่วนเท่านั้น (${coverage} chunks สำเร็จ) — ข้อมูลอาจไม่ครบถ้วน`,
        },
        {
          jobId: jobId.summarize(meetingId),
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
      const { count } = await prisma.meeting.updateMany({
        where: { id: meetingId, status: { notIn: TERMINAL_STATUSES } },
        data: { status: PrismaMeetingStatus.SUMMARIZING },
      });
      if (count > 0) {
        logger.warn({ meetingId, coverage }, 'transcribe.partialSuccess.queuedSummary');
      }
      return;
    }
  } catch (err) {
    logger.error({ meetingId, err: (err as Error).message }, 'tryPartialSummarize.checkFailed');
  }

  // Zero chunks transcribed or DB error — fall back to marking the meeting FAILED.
  await markMeetingFailed(meetingId, queue, reason);
}

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
