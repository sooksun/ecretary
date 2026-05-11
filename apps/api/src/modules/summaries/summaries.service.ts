import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { MeetingBoard, QueueName, SummaryOutput } from '@msec/shared';
import { computeMeetingProvenance } from '../../common/meeting-provenance';

@Injectable()
export class SummariesService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueName.SUMMARIZE) private readonly queue: Queue,
  ) {}

  async getBoard(meetingId: string, orgId: string): Promise<MeetingBoard> {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, organizationId: orgId },
      include: {
        participants: true,
        markers: { orderBy: { timestampSec: 'asc' } },
        actionItems: { orderBy: { createdAt: 'asc' } },
        summary: true,
        audioChunks: { select: { transcribeProvider: true } },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    const { provenance, summaryModel, isMock } = computeMeetingProvenance({
      summaryModelName: meeting.summary?.modelName,
      summaryPromptVersion: meeting.summary?.promptVersion,
      summaryQualityScore: meeting.summary?.qualityScore,
      transcribeProviders: meeting.audioChunks.map((c) => c.transcribeProvider),
    });

    const summary = meeting.summary
      ? ({
          executiveSummary: meeting.summary.executiveSummary,
          keyPoints: (meeting.summary.keyPointsJson as unknown as SummaryOutput['keyPoints']) ?? [],
          decisions: (meeting.summary.decisionsJson as unknown as SummaryOutput['decisions']) ?? [],
          actionItems: [],
          risks: (meeting.summary.risksJson as unknown as SummaryOutput['risks']) ?? [],
          pendingQuestions:
            (meeting.summary.pendingQuestionsJson as unknown as SummaryOutput['pendingQuestions']) ?? [],
          officialMinutes:
            (meeting.summary.officialMinutesJson as unknown as SummaryOutput['officialMinutes']) ?? {
              title: meeting.title,
              dateText: '',
              location: meeting.location,
              attendees: [],
              absentees: [],
              agendaItems: [],
            },
          qualityCheck:
            (meeting.summary.qualityCheckJson as unknown as SummaryOutput['qualityCheck']) ?? {
              missingFields: [],
              uncertainItems: [],
              recommendations: [],
            },
        } satisfies SummaryOutput)
      : null;

    return {
      meetingId: meeting.id,
      status: meeting.status,
      failureReason: meeting.failureReason ?? null,
      summary,
      summaryModel,
      isMock,
      provenance,
      participants: meeting.participants.map((p) => ({ name: p.name, roleLabel: p.roleLabel })),
      markers: meeting.markers.map((m) => ({
        markerType: m.markerType,
        timestampSec: m.timestampSec,
        note: m.note,
      })),
      actionItems: meeting.actionItems.map((a) => ({
        id: a.id,
        title: a.title,
        assigneeName: a.assigneeName,
        dueDate: a.dueDate ? a.dueDate.toISOString().slice(0, 10) : null,
        status: a.status,
      })),
    };
  }

  async getSummary(meetingId: string, orgId: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, organizationId: orgId },
      select: {
        id: true,
        audioChunks: { select: { transcribeProvider: true } },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    const summary = await this.prisma.meetingSummary.findUnique({ where: { meetingId } });
    if (!summary) {
      throw new NotFoundException('Summary not yet generated');
    }
    const { provenance, isMock } = computeMeetingProvenance({
      summaryModelName: summary.modelName,
      summaryPromptVersion: summary.promptVersion,
      summaryQualityScore: summary.qualityScore,
      transcribeProviders: meeting.audioChunks.map((c) => c.transcribeProvider),
    });
    return { ...summary, isMock, provenance };
  }

  async regenerate(meetingId: string, opts: { template?: string; notes?: string }, orgId: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, organizationId: orgId },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    await this.queue.add(
      'summarize-meeting',
      { meetingId, template: opts.template, notes: opts.notes, force: true },
      { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: 100, removeOnFail: 100 },
    );
    return { queued: true };
  }
}
