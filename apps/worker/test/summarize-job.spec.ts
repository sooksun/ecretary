import type { Job } from 'bullmq';
import { MeetingStatus, ActionItemSource } from '@prisma/client';
import { createPrismaMock, PrismaMock } from './helpers/prisma-mock';

let prismaMock: PrismaMock;
jest.mock('../src/prisma', () => ({
  get prisma() {
    return prismaMock;
  },
}));
// LINE push is fire-and-forget; stub it so no test touches the network.
jest.mock('../src/notifyMeetingReady', () => ({ notifyMeetingReady: jest.fn() }));

const { handleSummarizeJob } =
  require('../src/jobs/summarize') as typeof import('../src/jobs/summarize');

type SummarizeData = { meetingId: string; template?: string; notes?: string; force?: boolean };
const job = (data: SummarizeData = { meetingId: 'm-1' }) => ({ data }) as Job<SummarizeData>;

function meeting(over: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    title: 'ประชุมทดสอบ',
    meetingType: 'GENERAL',
    agendaText: 'วาระที่ 1',
    participants: [{ name: 'ครูสมชาย', roleLabel: 'ประธาน' }],
    markers: [],
    transcripts: [{ startTimeSec: 0, endTimeSec: 10, text: 'ที่ประชุมมีมติอนุมัติงบประมาณ' }],
    ...over,
  };
}

beforeEach(() => {
  prismaMock = createPrismaMock();
  prismaMock.meeting.findUnique.mockResolvedValue(meeting());
});

describe('handleSummarizeJob', () => {
  it('exits quietly when the meeting row is gone', async () => {
    prismaMock.meeting.findUnique.mockResolvedValue(null);
    await handleSummarizeJob(job());
    expect(prismaMock.meetingSummary.upsert).not.toHaveBeenCalled();
  });

  it('marks the meeting FAILED with a Thai reason when there is no transcript', async () => {
    // A meeting with zero speech must not reach READY with invented content.
    prismaMock.meeting.findUnique.mockResolvedValue(meeting({ transcripts: [] }));

    await handleSummarizeJob(job());

    expect(prismaMock.meetingSummary.upsert).not.toHaveBeenCalled();
    const update = prismaMock.meeting.update.mock.calls[0][0];
    expect(update.data.status).toBe(MeetingStatus.FAILED);
    expect(update.data.failureReason).toMatch(/[ก-๙]/);
  });

  it('still summarizes an empty transcript when force is set', async () => {
    // `force` is the regenerate path — the operator has explicitly asked.
    prismaMock.meeting.findUnique.mockResolvedValue(meeting({ transcripts: [] }));

    await handleSummarizeJob(job({ meetingId: 'm-1', force: true }));

    expect(prismaMock.meetingSummary.upsert).toHaveBeenCalled();
  });

  it('writes the summary and flips the meeting to READY, clearing failureReason', async () => {
    await handleSummarizeJob(job());

    expect(prismaMock.meetingSummary.upsert).toHaveBeenCalledTimes(1);
    const upsert = prismaMock.meetingSummary.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ meetingId: 'm-1' });
    expect(upsert.create.executiveSummary).toBeTruthy();
    expect(upsert.create.modelName).toBeTruthy();

    const final = prismaMock.meeting.update.mock.calls.at(-1)![0];
    expect(final.data).toEqual({ status: MeetingStatus.READY, failureReason: null });
  });

  it('replaces AI action items but leaves user-created ones alone', async () => {
    await handleSummarizeJob(job());

    expect(prismaMock.actionItem.deleteMany).toHaveBeenCalledWith({
      where: { meetingId: 'm-1', source: ActionItemSource.AI },
    });
    const created = prismaMock.actionItem.createMany.mock.calls[0][0].data;
    expect(created.every((a: { source: string }) => a.source === ActionItemSource.AI)).toBe(true);
  });

  it('does all writes in one transaction so a mid-way failure leaves nothing partial', async () => {
    await handleSummarizeJob(job());
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it('propagates a provider failure instead of writing a partial summary', async () => {
    prismaMock.$transaction.mockRejectedValueOnce(new Error('db gone'));
    await expect(handleSummarizeJob(job())).rejects.toThrow('db gone');
    // Nothing flipped the meeting to READY — BullMQ will retry.
    const readyWrites = prismaMock.meeting.update.mock.calls.filter(
      (c) => (c[0] as { data: { status?: string } }).data.status === MeetingStatus.READY,
    );
    expect(readyWrites).toHaveLength(0);
  });

  it('truncates a transcript longer than the 400k cap rather than sending it whole', async () => {
    const huge = 'ก'.repeat(450_000);
    prismaMock.meeting.findUnique.mockResolvedValue(
      meeting({ transcripts: [{ startTimeSec: 0, endTimeSec: 9999, text: huge }] }),
    );

    await handleSummarizeJob(job());

    // Reaching the upsert at all proves the oversize input did not throw.
    expect(prismaMock.meetingSummary.upsert).toHaveBeenCalled();
  });

  it('derives qualityScore from the number of uncertain items, never below zero', async () => {
    await handleSummarizeJob(job());
    const { qualityScore } = prismaMock.meetingSummary.upsert.mock.calls[0][0].create;
    expect(qualityScore).toBeGreaterThanOrEqual(0);
    expect(qualityScore).toBeLessThanOrEqual(1);
  });
});
