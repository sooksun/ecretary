import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateMarkerDto } from '@msec/shared';
import { MarkerType } from '@prisma/client';

@Injectable()
export class MarkersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(meetingId: string, dto: CreateMarkerDto, orgId: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, organizationId: orgId },
      select: { id: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    return this.prisma.meetingMarker.create({
      data: {
        meetingId,
        markerType: dto.markerType as MarkerType,
        timestampSec: dto.timestampSec,
        note: dto.note ?? null,
      },
    });
  }

  async list(meetingId: string, orgId: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, organizationId: orgId },
      select: { id: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return this.prisma.meetingMarker.findMany({
      where: { meetingId },
      orderBy: { timestampSec: 'asc' },
    });
  }
}
