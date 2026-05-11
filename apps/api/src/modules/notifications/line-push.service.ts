import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

interface LinePushBody {
  to: string;
  messages: Array<{ type: 'text'; text: string }>;
}

/**
 * Thin client for LINE Messaging API (push only — no webhook handling).
 *
 * Auth model: a Channel Access Token from a LINE Messaging API channel
 * lives in `LINE_CHANNEL_ACCESS_TOKEN`. Each user the bot pushes to must
 * first add the bot as a friend; the LINE userId comes from the bot's
 * webhook (out of scope here — store it on `User.lineUserId` via your
 * onboarding flow or admin panel).
 *
 * Privacy guard: never include raw transcript or personal contact info
 * in pushed messages. Send the summary headline + a deeplink only.
 */
@Injectable()
export class LinePushService {
  private readonly logger = new Logger(LinePushService.name);
  private readonly endpoint = 'https://api.line.me/v2/bot/message/push';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Push a plain-text message to one LINE userId.
   * Returns true if delivered, false if skipped (no token / no userId).
   * Network errors propagate so callers can decide retry.
   */
  async push(lineUserId: string | null | undefined, text: string): Promise<boolean> {
    const token = this.config.get<string>('LINE_CHANNEL_ACCESS_TOKEN');
    if (!token) {
      this.logger.warn('LINE_CHANNEL_ACCESS_TOKEN unset — push skipped (dev mode)');
      this.logger.debug({ lineUserId, text: text.slice(0, 80) }, 'line.push.dryrun');
      return false;
    }
    if (!lineUserId) {
      this.logger.debug('User has no lineUserId — push skipped');
      return false;
    }

    const body: LinePushBody = {
      to: lineUserId,
      messages: [{ type: 'text', text: text.slice(0, 5000) /* LINE 5000-char cap */ }],
    };

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`line.push ${res.status}: ${detail.slice(0, 200)}`);
    }
    return true;
  }

  /** Push to a user looked up by id; convenience for app code. */
  async pushToUser(userId: string, text: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { lineUserId: true },
    });
    return this.push(u?.lineUserId ?? null, text);
  }

  /**
   * Build the share-summary message for a meeting. Caller picks recipients.
   * Keep it short — LINE feed truncates at ~140 chars on mobile preview.
   */
  buildShareMessage(input: {
    title: string;
    dateText: string;
    executiveSummary: string;
    actionItemCount: number;
    deeplinkUrl?: string;
  }): string {
    const parts: string[] = [
      `📝 สรุปการประชุม: ${input.title}`,
      input.dateText,
      '',
      input.executiveSummary.slice(0, 300),
      '',
      `งานที่ติดตาม: ${input.actionItemCount} รายการ`,
    ];
    if (input.deeplinkUrl) parts.push('', `เปิดในแอป: ${input.deeplinkUrl}`);
    return parts.join('\n');
  }

  /** Reminder for upcoming due action item. */
  buildReminderMessage(input: {
    title: string;
    dueDate: string;
    meetingTitle: string;
  }): string {
    return [
      '⏰ เตือน: งานติดตามใกล้ครบกำหนด',
      '',
      input.title,
      `กำหนดส่ง: ${input.dueDate}`,
      `จากประชุม: ${input.meetingTitle}`,
    ].join('\n');
  }
}
