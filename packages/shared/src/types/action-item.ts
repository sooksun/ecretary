import type { ActionStatus } from '../enums';

export interface ActionItem {
  id: string;
  meetingId: string;
  title: string;
  description?: string | null;
  assigneeName?: string | null;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  status: ActionStatus;
  evidenceRequired?: string | null;
  sourceTimestampSec?: number | null;
  confidence?: number | null;
  createdAt: string;
  updatedAt: string;
}
