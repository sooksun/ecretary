import type { Job, Queue } from 'bullmq';
import { JobStatus, ChunkUploadStatus, MeetingStatus } from '@prisma/client';
import { createPrismaMock, createQueueMock, PrismaMock } from './helpers/prisma-mock';

let prismaMock: PrismaMock;
jest.mock('../src/prisma', () => ({
  get prisma() {
    return prismaMock;
  },
}));

const { handleTranscribeJob } =
  require('../src/jobs/transcribe') as typeof import('../src/jobs/transcribe');

const CHUNK = {
  id: 'c-1',
  meetingId: 'm-1',
  chunkIndex: 0,
  durationSec: 300,
  filePath: 'meetings/m-1/chunks/c-1.m4a',
  mimeType: 'audio/mp4',
  startedAtSec: 0,
};

function job(data = { chunkId: 'c-1', meetingId: 'm-1', key: CHUNK.filePath }) {
  return { data } as Job<{ chunkId: string; meetingId: string; key: string }>;
}

/** Meeting row shape read by maybeQueueSummary. */
function meetingRow(over: Partial<{ endedAt: Date | null; totalChunks: number | null }> = {}) {
  return {
    status: MeetingStatus.TRANSCRIBING,
    endedAt: new Date('2026-08-16T00:00:00Z'),
    totalChunks: 1,
    ...over,
  };
}

beforeEach(() => {
  prismaMock = createPrismaMock();
  prismaMock.audioChunk.findUnique.mockResolvedValue(CHUNK);
  prismaMock.meeting.findUnique.mockResolvedValue(meetingRow());
  prismaMock.audioChunk.groupBy.mockResolvedValue([
    { transcribeStatus: JobStatus.COMPLETED, _count: { _all: 1 } },
  ]);
});

describe('handleTranscribeJob', () => {
  it('exits quietly when the chunk row is gone', async () => {
    prismaMock.audioChunk.findUnique.mockResolvedValue(null);
    await handleTranscribeJob(job(), createQueueMock() as unknown as Queue);
    expect(prismaMock.audioChunk.update).not.toHaveBeenCalled();
    expect(prismaMock.transcriptSegment.createMany).not.toHaveBeenCalled();
  });

  it('refuses to drag a meeting back from a terminal/later state', async () => {
    // A stale BullMQ retry arriving after the meeting is READY must not flip it
    // to TRANSCRIBING — updateMany matching nothing is the signal to bail.
    prismaMock.meeting.updateMany.mockResolvedValue({ count: 0 });
    const queue = createQueueMock();

    await handleTranscribeJob(job(), queue as unknown as Queue);

    expect(prismaMock.transcriptSegment.createMany).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('guards that reset with notIn TERMINAL_OR_LATER_STATUSES', async () => {
    await handleTranscribeJob(job(), createQueueMock() as unknown as Queue);
    const where = prismaMock.meeting.updateMany.mock.calls[0][0].where;
    expect(where.status.notIn).toEqual(
      expect.arrayContaining([
        MeetingStatus.READY,
        MeetingStatus.FAILED,
        MeetingStatus.ARCHIVED,
        MeetingStatus.SUMMARIZING,
      ]),
    );
  });

  it('writes segments and marks the chunk transcribed on success', async () => {
    await handleTranscribeJob(job(), createQueueMock() as unknown as Queue);

    expect(prismaMock.transcriptSegment.createMany).toHaveBeenCalled();
    const rows = prismaMock.transcriptSegment.createMany.mock.calls[0][0].data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ meetingId: 'm-1', audioChunkId: 'c-1' });

    const finalUpdate = prismaMock.audioChunk.update.mock.calls.at(-1)![0];
    expect(finalUpdate.data).toMatchObject({
      transcribeStatus: JobStatus.COMPLETED,
      uploadStatus: ChunkUploadStatus.TRANSCRIBED,
      lastError: null,
    });
  });

  it('clears previous segments first so a retry cannot duplicate rows', async () => {
    await handleTranscribeJob(job(), createQueueMock() as unknown as Queue);
    expect(prismaMock.transcriptSegment.deleteMany).toHaveBeenCalledWith({
      where: { audioChunkId: 'c-1' },
    });
    // Both writes run inside one transaction.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('offsets segment timestamps by the chunk start so later chunks do not overlap', async () => {
    prismaMock.audioChunk.findUnique.mockResolvedValue({
      ...CHUNK,
      chunkIndex: 2,
      startedAtSec: 600,
    });

    await handleTranscribeJob(job(), createQueueMock() as unknown as Queue);

    const rows = prismaMock.transcriptSegment.createMany.mock.calls[0][0].data;
    expect(rows[0].startTimeSec).toBeGreaterThanOrEqual(600);
  });

  it('marks the chunk FAILED, bumps retryCount and rethrows so BullMQ retries', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Error('db exploded'));

    await expect(
      handleTranscribeJob(job(), createQueueMock() as unknown as Queue),
    ).rejects.toThrow('db exploded');

    const failUpdate = prismaMock.audioChunk.update.mock.calls.at(-1)![0];
    expect(failUpdate.data).toMatchObject({
      transcribeStatus: JobStatus.FAILED,
      uploadStatus: ChunkUploadStatus.FAILED_RETRY,
      retryCount: { increment: 1 },
      lastError: 'db exploded',
    });
  });
});

describe('handleTranscribeJob → summary enqueue', () => {
  it('queues the summary once every chunk is transcribed', async () => {
    const queue = createQueueMock();
    await handleTranscribeJob(job(), queue as unknown as Queue);

    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, payload, opts] = queue.add.mock.calls[0];
    expect(payload).toEqual({ meetingId: 'm-1' });
    // BullMQ rejects custom job ids containing ':'.
    expect(opts.jobId).not.toContain(':');
    expect(opts.jobId).toContain('m-1');
    expect(opts.attempts).toBeGreaterThan(1);
  });

  it('does not queue while the meeting is still recording (endedAt unset)', async () => {
    prismaMock.meeting.findUnique.mockResolvedValue(meetingRow({ endedAt: null }));
    const queue = createQueueMock();
    await handleTranscribeJob(job(), queue as unknown as Queue);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not queue before the client has declared totalChunks', async () => {
    prismaMock.meeting.findUnique.mockResolvedValue(meetingRow({ totalChunks: null }));
    const queue = createQueueMock();
    await handleTranscribeJob(job(), queue as unknown as Queue);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('does not queue while sibling chunks are still pending', async () => {
    prismaMock.meeting.findUnique.mockResolvedValue(meetingRow({ totalChunks: 3 }));
    prismaMock.audioChunk.groupBy.mockResolvedValue([
      { transcribeStatus: JobStatus.COMPLETED, _count: { _all: 2 } },
    ]);
    const queue = createQueueMock();
    await handleTranscribeJob(job(), queue as unknown as Queue);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('lets only one concurrent worker enqueue the summary', async () => {
    // First updateMany is the TRANSCRIBING reset (1), second is the
    // TRANSCRIBING→SUMMARIZING flip that a rival worker already won (0).
    prismaMock.meeting.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const queue = createQueueMock();

    await handleTranscribeJob(job(), queue as unknown as Queue);

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('flips the meeting to SUMMARIZING only from TRANSCRIBING or UPLOADING', async () => {
    await handleTranscribeJob(job(), createQueueMock() as unknown as Queue);
    const flip = prismaMock.meeting.updateMany.mock.calls.at(-1)![0];
    expect(flip.data.status).toBe(MeetingStatus.SUMMARIZING);
    expect(flip.where.status.in).toEqual(
      expect.arrayContaining([MeetingStatus.TRANSCRIBING, MeetingStatus.UPLOADING]),
    );
  });
});
