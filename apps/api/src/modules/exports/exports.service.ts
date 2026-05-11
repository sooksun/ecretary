import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ExportType, SummaryOutput, SummaryOutputSchema } from '@msec/shared';
import { ExportType as PrismaExportType } from '@prisma/client';
import { renderMinutesDocx } from './render/docx-renderer';
import { renderMinutesPdf } from './render/pdf-renderer';

@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async create(meetingId: string, exportType: ExportType, orgId: string, _template?: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, organizationId: orgId },
      include: {
        organization: true,
        summary: true,
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    if (exportType === ExportType.TRANSCRIPT_TXT) {
      return this.exportTranscriptTxt(meeting.id);
    }

    if (!meeting.summary) {
      throw new NotFoundException(
        'Meeting has no summary yet — wait for the worker to finish before exporting',
      );
    }

    const actionItems = await this.prisma.actionItem.findMany({
      where: { meetingId },
      orderBy: { createdAt: 'asc' },
    });
    const summary = this.reconstructSummary(meeting.summary, actionItems);

    let buffer: Buffer;
    let contentType: string;
    let ext: string;

    if (exportType === ExportType.DOCX) {
      buffer = await renderMinutesDocx({
        meetingTitle: meeting.title,
        meetingType: meeting.meetingType,
        organizationName: meeting.organization?.name,
        summary,
      });
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      ext = 'docx';
    } else if (exportType === ExportType.PDF) {
      try {
        buffer = await renderMinutesPdf({
          meetingTitle: meeting.title,
          meetingType: meeting.meetingType,
          organizationName: meeting.organization?.name,
          summary,
        });
      } catch (err) {
        const msg = (err as Error).message;
        if (msg.includes('Sarabun')) {
          throw new ServiceUnavailableException(msg);
        }
        throw err;
      }
      contentType = 'application/pdf';
      ext = 'pdf';
    } else {
      throw new NotFoundException(`Unsupported export type: ${exportType}`);
    }

    const key = `meetings/${meetingId}/exports/${Date.now()}.${ext}`;
    await this.storage.putObject({ key, body: buffer, contentType, contentLength: buffer.length });
    this.logger.log(
      `export ${exportType} meeting=${meetingId} bytes=${buffer.length} key=${key}`,
    );

    const record = await this.prisma.exportFile.create({
      data: {
        meetingId,
        exportType: exportType as PrismaExportType,
        filePath: key,
      },
    });

    return this.withDownloadUrl(record);
  }

  async list(meetingId: string, orgId: string) {
    await this.assertMeetingInOrg(meetingId, orgId);
    const rows = await this.prisma.exportFile.findMany({
      where: { meetingId },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(rows.map((r) => this.withDownloadUrl(r)));
  }

  async getById(id: string, orgId: string) {
    const f = await this.prisma.exportFile.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Export not found');
    await this.assertMeetingInOrg(f.meetingId, orgId);
    return this.withDownloadUrl(f);
  }

  // ── internals ─────────────────────────────────────────────────────────

  private async assertMeetingInOrg(meetingId: string, orgId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, organizationId: orgId },
      select: { id: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
  }

  private async exportTranscriptTxt(meetingId: string) {
    const segments = await this.prisma.transcriptSegment.findMany({
      where: { meetingId },
      orderBy: { startTimeSec: 'asc' },
    });
    const body = segments
      .map((s) => `[${formatTime(s.startTimeSec)}-${formatTime(s.endTimeSec)}] ${s.text}`)
      .join('\n');
    const buffer = Buffer.from(body, 'utf-8');
    const key = `meetings/${meetingId}/exports/${Date.now()}.txt`;
    await this.storage.putObject({
      key,
      body: buffer,
      contentType: 'text/plain; charset=utf-8',
      contentLength: buffer.length,
    });
    const record = await this.prisma.exportFile.create({
      data: {
        meetingId,
        exportType: PrismaExportType.TRANSCRIPT_TXT,
        filePath: key,
      },
    });
    return this.withDownloadUrl(record);
  }

  private reconstructSummary(
    row: {
      executiveSummary: string;
      keyPointsJson: unknown;
      decisionsJson: unknown;
      risksJson: unknown;
      pendingQuestionsJson: unknown;
      officialMinutesJson: unknown;
      qualityCheckJson: unknown;
    },
    actionItems: Array<{
      title: string;
      description: string | null;
      assigneeName: string | null;
      dueDate: Date | null;
      evidenceRequired: string | null;
      sourceTimestampSec: number | null;
      confidence: number | null;
    }>,
  ): SummaryOutput {
    const candidate = {
      executiveSummary: row.executiveSummary,
      keyPoints: (row.keyPointsJson as unknown[]) ?? [],
      decisions: (row.decisionsJson as unknown[]) ?? [],
      actionItems: actionItems.map((a) => ({
        title: a.title,
        description: a.description,
        assigneeName: a.assigneeName,
        dueDate: a.dueDate ? a.dueDate.toISOString().slice(0, 10) : null,
        evidenceRequired: a.evidenceRequired,
        sourceTimestampSec: a.sourceTimestampSec,
        confidence: a.confidence ?? 0.5,
      })),
      risks: (row.risksJson as unknown[]) ?? [],
      pendingQuestions: (row.pendingQuestionsJson as unknown[]) ?? [],
      officialMinutes: row.officialMinutesJson ?? {
        title: '',
        dateText: '',
        attendees: [],
        absentees: [],
        agendaItems: [],
      },
      qualityCheck: row.qualityCheckJson ?? {
        missingFields: [],
        uncertainItems: [],
        recommendations: [],
      },
    };
    return SummaryOutputSchema.parse(candidate);
  }

  private async withDownloadUrl(record: {
    id: string;
    meetingId: string;
    exportType: PrismaExportType;
    filePath: string;
    createdAt: Date;
  }) {
    const downloadUrl = await this.storage.getSignedDownloadUrl(record.filePath, 3600);
    return { ...record, downloadUrl };
  }
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}
