import { MeetingStatus as PrismaMeetingStatus } from '@prisma/client';

/**
 * Terminal statuses — a meeting in one of these states must NOT be overwritten
 * with FAILED by a late-arriving job event or the sweep.  READY and ARCHIVED
 * are terminal-success; FAILED is already terminal.
 *
 * Exported so that main.ts, sweep.ts, and transcribe.ts all share one list.
 * Add new terminal statuses here first; all three files update automatically.
 */
export const TERMINAL_STATUSES: PrismaMeetingStatus[] = [
  PrismaMeetingStatus.READY,
  PrismaMeetingStatus.ARCHIVED,
  PrismaMeetingStatus.FAILED,
];

/**
 * TERMINAL_STATUSES + SUMMARIZING.
 *
 * Used in transcribe.ts to guard against flipping a meeting back to
 * TRANSCRIBING after it has already advanced to summarisation or beyond.
 */
export const TERMINAL_OR_LATER_STATUSES: PrismaMeetingStatus[] = [
  ...TERMINAL_STATUSES,
  PrismaMeetingStatus.SUMMARIZING,
];

