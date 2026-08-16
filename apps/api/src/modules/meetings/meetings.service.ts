import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import type { CreateMeetingDto, UpdateMeetingDto } from '@msec/shared';
import { MeetingStatus, MeetingType as SharedMeetingType } from '@msec/shared';
import { MeetingStatus as PrismaMeetingStatus, MeetingType as PrismaMeetingType } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { computeMeetingProvenance } from '../../common/meeting-provenance';
import { AuditService, AuditAction, AuditResource } from '../../common/audit/audit.service';

@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

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

  async list(
    query: { status?: string; q?: string; from?: string; to?: string; cursor?: string; limit?: number },
    orgId: string,
  ) {
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
    const limit = Math.min(query.limit ?? 50, 100);

    const rows = await this.prisma.meeting.findMany({
      where: {
        organizationId: orgId,
        status: query.status ? (query.status as PrismaMeetingStatus) : undefined,
        title: query.q ? { contains: query.q, mode: 'insensitive' } : undefined,
        createdAt: { gte: fromDate, lte: toDate },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;
    return { items, nextCursor };
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

  async end(id: string, orgId: string, totalChunks?: number) {
    await this.assertExists(id, orgId);
    return this.prisma.meeting.update({
      where: { id },
      data: {
        status: PrismaMeetingStatus.UPLOADING,
        endedAt: new Date(),
        totalChunks: totalChunks ?? null,
      },
    });
  }

  async delete(id: string, orgId: string, actorUserId: string | null = null): Promise<void> {
    const meeting = await this.assertExists(id, orgId);

    // Collect S3 keys BEFORE the cascade delete removes child rows.
    // Both queries are independent — run in parallel.
    const [chunks, exportFiles] = await Promise.all([
      this.prisma.audioChunk.findMany({
        where: { meetingId: id },
        select: { filePath: true },
      }),
      this.prisma.exportFile.findMany({
        where: { meetingId: id },
        select: { filePath: true },
      }),
    ]);
    const keys = [
      ...chunks.map((c) => c.filePath),
      ...exportFiles.map((e) => e.filePath),
    ];

    // Scope the delete to this org so the operation is self-authorising even
    // if a future change to assertExists() introduces a bug.
    await this.prisma.meeting.deleteMany({ where: { id, organizationId: orgId } });

    // Recorded AFTER the delete succeeds: an audit trail that lists deletions
    // which never happened is worse than one that is merely incomplete.
    // The title is kept because the row it identifies no longer exists.
    await this.audit.record({
      actorUserId,
      action: AuditAction.MEETING_DELETE,
      resourceType: AuditResource.MEETING,
      resourceId: id,
      metadata: {
        title: meeting.title,
        organizationId: orgId,
        audioChunksDeleted: chunks.length,
        exportFilesDeleted: exportFiles.length,
      },
    });

    // Best-effort S3 cleanup — orphaned objects are acceptable but DB rows
    // pointing to deleted objects are not, so we delete DB first.
    if (keys.length > 0) {
      void this.storage.deleteObjects(keys).catch((err) => {
        this.logger.warn(
          { meetingId: id, err: (err as Error).message },
          'meeting.delete.s3Cleanup.failed',
        );
      });
    }
  }

  async setStatus(id: string, status: MeetingStatus) {
    return this.prisma.meeting.update({
      where: { id },
      data: { status: status as PrismaMeetingStatus },
    });
  }

  /** Returns the row so callers that need identifying fields (e.g. the audit
   *  trail, which must record what was destroyed) don't re-query. */
  private async assertExists(id: string, orgId: string) {
    const exists = await this.prisma.meeting.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, title: true },
    });
    if (!exists) throw new NotFoundException('Meeting not found');
    return exists;
  }
}
