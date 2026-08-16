import { MeetingStatus } from '@prisma/client';
import { createPrismaMock, PrismaMock } from './helpers/prisma-mock';

let prismaMock: PrismaMock;
jest.mock('../src/prisma', () => ({
  get prisma() {
    return prismaMock;
  },
}));
const alertMock = jest.fn();
jest.mock('../src/alertWebhook', () => ({ alertMeetingFailed: (...a: unknown[]) => alertMock(...a) }));

const { handleSweepJob } = require('../src/jobs/sweep') as typeof import('../src/jobs/sweep');

beforeEach(() => {
  prismaMock = createPrismaMock();
  alertMock.mockClear();
});

describe('handleSweepJob', () => {
  it('does nothing when no meeting is stuck', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([]);
    await handleSweepJob();
    expect(prismaMock.meeting.updateMany).not.toHaveBeenCalled();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('only looks at RECORDING/UPLOADING meetings older than the threshold', async () => {
    await handleSweepJob();
    const where = prismaMock.meeting.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual(
      expect.arrayContaining([MeetingStatus.RECORDING, MeetingStatus.UPLOADING]),
    );
    expect(where.updatedAt.lt).toBeInstanceOf(Date);
    // The cutoff is in the past, never the future.
    expect(where.updatedAt.lt.getTime()).toBeLessThan(Date.now());
  });

  it('marks a stuck meeting FAILED with an explanatory reason', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([
      { id: 'm-1', status: MeetingStatus.UPLOADING, title: 'ประชุมค้าง' },
    ]);

    await handleSweepJob();

    const update = prismaMock.meeting.updateMany.mock.calls[0][0];
    expect(update.data.status).toBe(MeetingStatus.FAILED);
    expect(update.data.failureReason).toContain('UPLOADING');
    expect(update.data.failureReason.length).toBeLessThanOrEqual(500);
  });

  it('never overwrites a meeting that already reached a terminal state', async () => {
    // Between the findMany and the update, a late job may have finished the
    // meeting; the notIn guard is what stops the sweeper clobbering READY.
    prismaMock.meeting.findMany.mockResolvedValue([
      { id: 'm-1', status: MeetingStatus.RECORDING, title: 'x' },
    ]);

    await handleSweepJob();

    const where = prismaMock.meeting.updateMany.mock.calls[0][0].where;
    expect(where.status.notIn).toEqual(
      expect.arrayContaining([MeetingStatus.READY, MeetingStatus.ARCHIVED, MeetingStatus.FAILED]),
    );
  });

  it('alerts only for meetings it actually transitioned', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([
      { id: 'm-1', status: MeetingStatus.RECORDING, title: 'x' },
    ]);
    prismaMock.meeting.updateMany.mockResolvedValue({ count: 0 }); // lost the race

    await handleSweepJob();

    expect(alertMock).not.toHaveBeenCalled();
  });

  it('processes every stuck meeting, not just the first', async () => {
    prismaMock.meeting.findMany.mockResolvedValue([
      { id: 'm-1', status: MeetingStatus.RECORDING, title: 'a' },
      { id: 'm-2', status: MeetingStatus.UPLOADING, title: 'b' },
      { id: 'm-3', status: MeetingStatus.RECORDING, title: 'c' },
    ]);

    await handleSweepJob();

    expect(prismaMock.meeting.updateMany).toHaveBeenCalledTimes(3);
    expect(alertMock).toHaveBeenCalledTimes(3);
  });
});
