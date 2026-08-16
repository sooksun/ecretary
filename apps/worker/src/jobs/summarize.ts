import type { Job } from 'bullmq';
import { MeetingStatus as PrismaMeetingStatus, ActionItemSource } from '@prisma/client';
import { prisma } from '../prisma';
import { logger } from '../logger';
import { MockSummarizationProvider, SummarizationProvider } from '../ai/summarization';
import { ClaudeSummarizationProvider } from '../ai/llm-provider';
import { OpenAISummarizationProvider } from '../ai/openai-provider';
import { config } from '../config';
import { notifyMeetingReady } from '../notifyMeetingReady';

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
      logger.info({ model: config.llmModel }, 'summarize.provider=claude');
      provider = new ClaudeSummarizationProvider();
      break;
    case 'openai':
    case 'deepseek':
    case 'ollama':
    case 'openrouter':
      logger.info({ provider: config.llmProvider, model: config.llmModel }, `summarize.provider=${config.llmProvider}`);
      provider = new OpenAISummarizationProvider({ providerTag: config.llmProvider });
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
  const { meetingId, template, notes, force } = job.data;
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
    logger.info({ meetingId }, 'summarize.skip.noTranscript.markingFailed');
    await prisma.meeting.update({
      where: { id: meetingId },
      data: {
        status: PrismaMeetingStatus.FAILED,
        failureReason: 'ไม่พบเสียงพูดหรือข้อความการสนทนาสำหรับการสรุปผลการประชุม',
      },
    });
    return;
  }

  const MAX_TRANSCRIPT_CHARS = 400_000;
  let transcriptText = meeting.transcripts
    .map((t) => `[${t.startTimeSec}-${t.endTimeSec}] ${t.text}`)
    .join('\n');
  if (transcriptText.length > MAX_TRANSCRIPT_CHARS) {
    logger.warn({ meetingId, charCount: transcriptText.length }, 'summarize.transcriptTruncated');
    transcriptText =
      transcriptText.slice(0, MAX_TRANSCRIPT_CHARS) +
      '\n...(transcript ถูกตัดเนื่องจากยาวเกิน 400,000 ตัวอักษร)';
  }

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
    notes,
  });

  const summaryFields = {
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
  };

  // All four writes are atomic: if any step fails mid-way (e.g. DB connection
  // drop) the meeting stays SUMMARIZING and BullMQ retries the whole job —
  // no partial summary or orphaned action items survive.
  await prisma.$transaction(async (tx) => {
    await tx.meetingSummary.upsert({
      where: { meetingId },
      create: { meetingId, ...summaryFields },
      update: summaryFields,
    });

    // Replace AI-generated action items; MANUAL items created by users are preserved.
    await tx.actionItem.deleteMany({
      where: { meetingId, source: ActionItemSource.AI },
    });
    if (summary.actionItems.length > 0) {
      await tx.actionItem.createMany({
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

    // Belt-and-braces: clear any stale failureReason from a previous attempt.
    await tx.meeting.update({
      where: { id: meetingId },
      data: { status: PrismaMeetingStatus.READY, failureReason: null },
    });
  });

  logger.info({ meetingId, actionItems: summary.actionItems.length }, 'summarize.done');

  // Fire-and-forget: push LINE summary notification if the creator has linked LINE.
  void notifyMeetingReady(meetingId, summary.executiveSummary);
}
