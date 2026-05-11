import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TranscriptsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(meetingId: string, orgId: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, organizationId: orgId },
      select: { id: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return this.prisma.transcriptSegment.findMany({
      where: { meetingId },
      orderBy: { startTimeSec: 'asc' },
    });
  }
}
