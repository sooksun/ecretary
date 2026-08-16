import { prisma } from './prisma';
import { logger } from './logger';

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const TIMEOUT_MS = 5_000;

/**
 * Fire-and-forget: push a LINE notification to the meeting creator when the
 * summary is ready. Silently no-ops when LINE_CHANNEL_ACCESS_TOKEN is unset
 * or the user has no lineUserId.
 */
export async function notifyMeetingReady(
  meetingId: string,
  executiveSummary: string,
): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return;

  try {
    const meeting = await prisma.meeting.findUnique({
      where: { id: meetingId },
      select: {
        title: true,
        createdBy: { select: { lineUserId: true } },
      },
    });

    const lineUserId = meeting?.createdBy?.lineUserId;
    if (!lineUserId) return;

    const text = [
      `📝 สรุปการประชุมพร้อมแล้ว: ${meeting.title ?? meetingId}`,
      ``,
      executiveSummary.slice(0, 280),
    ].join('\n');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(LINE_PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          to: lineUserId,
          messages: [{ type: 'text', text }],
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        logger.warn({ meetingId, status: res.status, detail: detail.slice(0, 200) }, 'line.push.failed');
      } else {
        logger.info({ meetingId }, 'line.push.sent');
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    logger.warn({ meetingId, err: (err as Error).message }, 'line.push.error');
  }
}
