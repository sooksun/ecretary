import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ActionStatus } from '@msec/shared';
import { ActionStatus as PrismaActionStatus, ActionItemSource } from '@prisma/client';

export interface CreateActionItemInput {
  title: string;
  description?: string | null;
  assigneeName?: string | null;
  dueDate?: string | null;
  evidenceRequired?: string | null;
  sourceTimestampSec?: number | null;
  confidence?: number | null;
}

export interface UpdateActionItemInput {
  title?: string;
  description?: string | null;
  assigneeName?: string | null;
  dueDate?: string | null;
  status?: ActionStatus;
  evidenceRequired?: string | null;
}

@Injectable()
export class ActionItemsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(meetingId: string, orgId: string, filter?: { status?: string }) {
    await this.assertMeetingInOrg(meetingId, orgId);
    return this.prisma.actionItem.findMany({
      where: {
        meetingId,
        status: filter?.status ? (filter.status as PrismaActionStatus) : undefined,
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(meetingId: string, dto: CreateActionItemInput, orgId: string) {
    await this.assertMeetingInOrg(meetingId, orgId);
    return this.prisma.actionItem.create({
      data: {
        meetingId,
        source: ActionItemSource.MANUAL,
        title: dto.title,
        description: dto.description ?? null,
        assigneeName: dto.assigneeName ?? null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        evidenceRequired: dto.evidenceRequired ?? null,
        sourceTimestampSec: dto.sourceTimestampSec ?? null,
        confidence: dto.confidence ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateActionItemInput, orgId: string) {
    const existing = await this.prisma.actionItem.findUnique({
      where: { id },
      select: { id: true, meetingId: true },
    });
    if (!existing) throw new NotFoundException('Action item not found');
    await this.assertMeetingInOrg(existing.meetingId, orgId);

    return this.prisma.actionItem.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description ?? undefined,
        assigneeName: dto.assigneeName ?? undefined,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: dto.status ? (dto.status as PrismaActionStatus) : undefined,
        evidenceRequired: dto.evidenceRequired ?? undefined,
      },
    });
  }

  private async assertMeetingInOrg(meetingId: string, orgId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, organizationId: orgId },
      select: { id: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
  }
}
