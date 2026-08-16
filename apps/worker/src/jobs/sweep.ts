import { MeetingStatus as PrismaMeetingStatus } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { alertMeetingFailed } from '../alertWebhook';
import { redactSecrets } from '../redactSecrets';
import { TERMINAL_STATUSES } from '../meetingConstants';

// Meetings stuck in RECORDING or UPLOADING for longer than this threshold
// are treated as abandoned and marked FAILED with a descriptive reason.
const STUCK_THRESHOLD_MS = Number(process.env.STUCK_MEETING_THRESHOLD_MS ?? 2 * 60 * 60 * 1000); // 2h

export async function handleSweepJob(): Promise<void> {
  const threshold = new Date(Date.now() - STUCK_THRESHOLD_MS);

  // Find meetings stuck in RECORDING or UPLOADING beyond the threshold.
  const stuck = await prisma.meeting.findMany({
    where: {
      status: { in: [PrismaMeetingStatus.RECORDING, PrismaMeetingStatus.UPLOADING] },
      updatedAt: { lt: threshold },
    },
    select: { id: true, status: true, title: true },
  });

  if (stuck.length === 0) return;

  logger.warn({ count: stuck.length }, 'sweep.stuckMeetingsFound');

  for (const meeting of stuck) {
    const reason = redactSecrets(
      `Meeting was stuck in ${meeting.status} for over ${Math.round(STUCK_THRESHOLD_MS / 60_000)} minutes with no activity. ` +
        `This usually means the recording device disconnected or crashed before all audio chunks were uploaded. ` +
        `Use forceProcess to retry if chunks arrived later.`,
    );
    const { count } = await prisma.meeting.updateMany({
      where: { id: meeting.id, status: { notIn: TERMINAL_STATUSES } },
      data: { status: PrismaMeetingStatus.FAILED, failureReason: reason.slice(0, 500) },
    });
    if (count > 0) {
      logger.warn({ meetingId: meeting.id, wasStatus: meeting.status }, 'sweep.meetingMarkedFailed');
      void alertMeetingFailed({ meetingId: meeting.id, queue: 'sweep', reason });
    }
  }
}
