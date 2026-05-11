import { z } from 'zod';

export const KeyPointSchema = z.object({
  title: z.string(),
  detail: z.string(),
  confidence: z.number().min(0).max(1),
  sourceTimestampSec: z.number().int().nullable().optional(),
});

export const DecisionSchema = z.object({
  decision: z.string(),
  rationale: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  sourceTimestampSec: z.number().int().nullable().optional(),
});

export const ActionItemDraftSchema = z.object({
  title: z.string(),
  description: z.string().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  evidenceRequired: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  sourceTimestampSec: z.number().int().nullable().optional(),
});

export const RiskSchema = z.object({
  risk: z.string(),
  impact: z.string().nullable().optional(),
  recommendation: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const PendingQuestionSchema = z.object({
  question: z.string(),
  owner: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
});

export const OfficialMinutesAgendaItemSchema = z.object({
  agendaNo: z.string(),
  topic: z.string(),
  discussion: z.string(),
  resolution: z.string().nullable().optional(),
});

export const OfficialMinutesSchema = z.object({
  title: z.string(),
  dateText: z.string(),
  location: z.string().nullable().optional(),
  attendees: z.array(z.string()),
  absentees: z.array(z.string()),
  participants: z.array(z.string()).optional(),
  agendaItems: z.array(OfficialMinutesAgendaItemSchema),
  closedAt: z.string().nullable().optional(),
  minuteTaker: z.string().nullable().optional(),
  reviewer: z.string().nullable().optional(),
});

export const QualityCheckSchema = z.object({
  missingFields: z.array(z.string()),
  uncertainItems: z.array(z.string()),
  recommendations: z.array(z.string()),
});

export const SummaryOutputSchema = z.object({
  executiveSummary: z.string(),
  keyPoints: z.array(KeyPointSchema),
  decisions: z.array(DecisionSchema),
  actionItems: z.array(ActionItemDraftSchema),
  risks: z.array(RiskSchema),
  pendingQuestions: z.array(PendingQuestionSchema),
  officialMinutes: OfficialMinutesSchema,
  qualityCheck: QualityCheckSchema,
});

export type SummaryOutputDto = z.infer<typeof SummaryOutputSchema>;
