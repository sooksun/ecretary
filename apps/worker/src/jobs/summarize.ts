import type { Job } from 'bullmq';
import { MeetingStatus as PrismaMeetingStatus, ActionItemSource } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { MockSummarizationProvider, SummarizationProvider } from '../ai/summarization';
import { ClaudeSummarizationProvider } from '../ai/llm-provider';
import { config } from '../config';

export interface SummarizeJobData {
  meetingId: string;
  template?: string;
  notes?: string;
  force?: boolean;
}

let provider: SummarizationProvider | null = null;
function getProvider(): SummarizationProvider {
  if (provider) return provider;
  switch (config.llmProvider) {
    case 'claude':
      // Init can throw on missing ANTHROPIC_API_KEY. Preflight already
      // catches that at boot, so this should never fire in practice — but
      // if it does, propagate (no silent mock fallback).
      logger.info({ model: config.llmModel }, 'summarize.provider=claude');
      provider = new ClaudeSummarizationProvider();
      break;
    case 'mock':
    default:
      logger.info({}, 'summarize.provider=mock');
      provider = new MockSummarizationProvider();
      break;
  }
  return provider;
}

export async function handleSummarizeJob(job: Job<SummarizeJobData>): Promise<void> {
  const { meetingId, template, force } = job.data;
  logger.info({ meetingId, template, force }, 'summarize.start');

  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      participants: true,
      markers: { orderBy: { timestampSec: 'asc' } },
      transcripts: { orderBy: { startTimeSec: 'asc' } },
    },
  });
  if (!meeting) {
    logger.warn({ meetingId }, 'summarize.meetingNotFound');
    return;
  }
  if (meeting.transcripts.length === 0 && !force) {
    logger.info({ meetingId }, 'summarize.skip.noTranscript');
    return;
  }

  const transcriptText = meeting.transcripts
    .map((t) => `[${t.startTimeSec}-${t.endTimeSec}] ${t.text}`)
    .join('\n');

  const { summary, modelName, promptVersion } = await getProvider().summarize({
    meetingId,
    title: meeting.title,
    meetingType: meeting.meetingType,
    agendaText: meeting.agendaText,
    participants: meeting.participants.map((p) => ({ name: p.name, roleLabel: p.roleLabel })),
    markers: meeting.markers.map((m) => ({
      markerType: m.markerType,
      timestampSec: m.timestampSec,
      note: m.note,
    })),
    transcriptText,
    template,
  });

  await prisma.meetingSummary.upsert({
    where: { meetingId },
    create: {
      meetingId,
      executiveSummary: summary.executiveSummary,
      keyPointsJson: summary.keyPoints as object,
      decisionsJson: summary.decisions as object,
      risksJson: summary.risks as object,
      pendingQuestionsJson: summary.pendingQuestions as object,
      officialMinutesJson: summary.officialMinutes as object,
      qualityCheckJson: summary.qualityCheck as object,
      modelName,
      promptVersion,
      qualityScore: Math.max(0, 1 - summary.qualityCheck.uncertainItems.length * 0.05),
    },
    update: {
      executiveSummary: summary.executiveSummary,
      keyPointsJson: summary.keyPoints as object,
      decisionsJson: summary.decisions as object,
      risksJson: summary.risks as object,
      pendingQuestionsJson: summary.pendingQuestions as object,
      officialMinutesJson: summary.officialMinutes as object,
      qualityCheckJson: summary.qualityCheck as object,
      modelName,
      promptVersion,
      qualityScore: Math.max(0, 1 - summary.qualityCheck.uncertainItems.length * 0.05),
    },
  });

  // Replace AI-generated action items; MANUAL items created by users are preserved.
  await prisma.actionItem.deleteMany({
    where: { meetingId, source: ActionItemSource.AI },
  });
  if (summary.actionItems.length > 0) {
    await prisma.actionItem.createMany({
      data: summary.actionItems.map((a) => ({
        meetingId,
        source: ActionItemSource.AI,
        title: a.title,
        description: a.description ?? null,
        assigneeName: a.assigneeName ?? null,
        dueDate: a.dueDate ? new Date(a.dueDate) : null,
        evidenceRequired: a.evidenceRequired ?? null,
        sourceTimestampSec: a.sourceTimestampSec ?? null,
        confidence: a.confidence,
      })),
    });
  }

  // Belt-and-braces: if a previous attempt populated failureReason and was
  // later retried successfully, clear it so the READY meeting carries no
  // stale "this failed because…" message. transcribe.ts already clears it
  // when chunks start, but a regenerate-summary path skips transcribe.
  await prisma.meeting.update({
    where: { id: meetingId },
    data: { status: PrismaMeetingStatus.READY, failureReason: null },
  });

  logger.info({ meetingId, actionItems: summary.actionItems.length }, 'summarize.done');
}
