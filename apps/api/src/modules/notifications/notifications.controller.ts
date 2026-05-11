import { BadRequestException, Body, Controller, NotFoundException, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { LinePushService } from './line-push.service';

const ShareSchema = z.object({
  /** LINE userIds to push to. If omitted, push to the meeting creator. */
  recipientUserIds: z.array(z.string().uuid()).optional(),
  /** Optional deeplink — typically points back to the meeting board. */
  deeplinkUrl: z.string().url().optional(),
});

@Controller('meetings')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly line: LinePushService,
  ) {}

  /**
   * POST /meetings/:id/share
   * Push the meeting's executive summary to LINE for the listed users
   * (or the creator if none specified). Caller's auth is verified by the
   * global guard; we don't enforce ownership beyond org scoping.
   */
  @Post(':id/share')
  async share(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ShareSchema)) body: z.infer<typeof ShareSchema>,
    @CurrentUser() actor: AuthUser,
  ) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id },
      include: { summary: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    if (meeting.organizationId !== actor.organizationId) {
      throw new NotFoundException('Meeting not found');
    }
    if (!meeting.summary) {
      throw new BadRequestException('Meeting has no summary yet');
    }

    const targetIds = body.recipientUserIds?.length
      ? body.recipientUserIds
      : [meeting.createdById];

    const recipients = await this.prisma.user.findMany({
      where: { id: { in: targetIds }, organizationId: actor.organizationId },
      select: { id: true, name: true, lineUserId: true },
    });

    const actionItemCount = await this.prisma.actionItem.count({
      where: { meetingId: id },
    });

    const message = this.line.buildShareMessage({
      title: meeting.title,
      dateText: meeting.startedAt?.toLocaleDateString('th-TH') ?? '',
      executiveSummary: meeting.summary.executiveSummary,
      actionItemCount,
      deeplinkUrl: body.deeplinkUrl,
    });

    const results = await Promise.allSettled(
      recipients.map((r) => this.line.push(r.lineUserId, message)),
    );

    return {
      meetingId: id,
      attempted: recipients.length,
      delivered: results.filter((r) => r.status === 'fulfilled' && r.value === true).length,
      skipped: results.filter((r) => r.status === 'fulfilled' && r.value === false).length,
      failed: results.filter((r) => r.status === 'rejected').length,
    };
  }
}
