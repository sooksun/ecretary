import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateMeetingDto, UpdateMeetingDto } from '@msec/shared';
import { MeetingStatus, MeetingType as SharedMeetingType } from '@msec/shared';
import { MeetingStatus as PrismaMeetingStatus, MeetingType as PrismaMeetingType } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { computeMeetingProvenance } from '../../common/meeting-provenance';

@Injectable()
export class MeetingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMeetingDto, actor: AuthUser) {
    return this.prisma.meeting.create({
      data: {
        organizationId: actor.organizationId,
        createdById: actor.id,
        title: dto.title,
        meetingType: (dto.meetingType ?? SharedMeetingType.GENERAL) as PrismaMeetingType,
        location: dto.location ?? null,
        agendaText: dto.agendaText ?? null,
        status: PrismaMeetingStatus.DRAFT,
        participants: dto.participants?.length
          ? {
              create: dto.participants.map((p) => ({
                name: p.name,
                roleLabel: p.roleLabel ?? null,
                attendanceStatus: p.attendanceStatus ?? 'present',
              })),
            }
          : undefined,
      },
      include: { participants: true },
    });
  }

  async list(query: { status?: string; q?: string; from?: string; to?: string }, orgId: string) {
    if (query.status && !Object.values(PrismaMeetingStatus).includes(query.status as PrismaMeetingStatus)) {
      throw new BadRequestException(`Invalid status value: "${query.status}". Valid values: ${Object.values(PrismaMeetingStatus).join(', ')}`);
    }
    const fromDate = query.from ? new Date(query.from) : undefined;
    const toDate = query.to ? new Date(query.to) : undefined;
    if (fromDate && isNaN(fromDate.getTime())) {
      throw new BadRequestException(`Invalid "from" date: "${query.from}"`);
    }
    if (toDate && isNaN(toDate.getTime())) {
      throw new BadRequestException(`Invalid "to" date: "${query.to}"`);
    }
    return this.prisma.meeting.findMany({
      where: {
        organizationId: orgId,
        status: query.status ? (query.status as PrismaMeetingStatus) : undefined,
        title: query.q ? { contains: query.q, mode: 'insensitive' } : undefined,
        createdAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getById(id: string, orgId: string) {
    const m = await this.prisma.meeting.findFirst({
      where: { id, organizationId: orgId },
      include: {
        participants: true,
        markers: { orderBy: { timestampSec: 'asc' } },
        // Pulled solely to compute provenance below; small per-row payload.
        summary: {
          select: { modelName: true, promptVersion: true, qualityScore: true },
        },
        audioChunks: { select: { transcribeProvider: true } },
        _count: { select: { audioChunks: true, transcripts: true, actionItems: true } },
      },
    });
    if (!m) throw new NotFoundException('Meeting not found');

    const { provenance, summaryModel, isMock } = computeMeetingProvenance({
      summaryModelName: m.summary?.modelName,
      summaryPromptVersion: m.summary?.promptVersion,
      summaryQualityScore: m.summary?.qualityScore,
      transcribeProviders: m.audioChunks.map((c) => c.transcribeProvider),
    });

    // Drop the raw join-payloads from the response — they were only fetched
    // to feed computeMeetingProvenance. Keeps the public shape narrow.
    const { summary: _s, audioChunks: _c, ...rest } = m;
    return { ...rest, summaryModel, isMock, provenance };
  }

  async update(id: string, dto: UpdateMeetingDto, orgId: string) {
    await this.assertExists(id, orgId);
    return this.prisma.meeting.update({
      where: { id },
      data: {
        title: dto.title,
        meetingType: dto.meetingType as PrismaMeetingType | undefined,
        location: dto.location ?? undefined,
        agendaText: dto.agendaText ?? undefined,
      },
    });
  }

  async start(id: string, orgId: string) {
    await this.assertExists(id, orgId);
    return this.prisma.meeting.update({
      where: { id },
      data: {
        status: PrismaMeetingStatus.RECORDING,
        startedAt: new Date(),
      },
    });
  }

  async end(id: string, orgId: string) {
    await this.assertExists(id, orgId);
    return this.prisma.meeting.update({
      where: { id },
      data: {
        status: PrismaMeetingStatus.UPLOADING,
        endedAt: new Date(),
      },
    });
  }

  async setStatus(id: string, status: MeetingStatus) {
    return this.prisma.meeting.update({
      where: { id },
      data: { status: status as PrismaMeetingStatus },
    });
  }

  private async assertExists(id: string, orgId: string) {
    const exists = await this.prisma.meeting.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Meeting not found');
  }
}
