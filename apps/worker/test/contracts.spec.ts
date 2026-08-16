import { SummaryOutputSchema, jobId, QueueName, MeetingStatus } from '@msec/shared';
import { MockSummarizationProvider } from '../src/ai/summarization';
import { MockTranscriptionProvider } from '../src/ai/transcription';
import { TERMINAL_STATUSES, TERMINAL_OR_LATER_STATUSES } from '../src/meetingConstants';
import { MeetingStatus as PrismaMeetingStatus } from '@prisma/client';

describe('MockSummarizationProvider', () => {
  it('produces output that satisfies the same schema real providers must meet', async () => {
    // The mock is the reference implementation of the contract. If it ever
    // drifts from SummaryOutputSchema, dev runs pass while production fails.
    const { summary, modelName, promptVersion } = await new MockSummarizationProvider().summarize({
      meetingId: 'm-1',
      title: 'ประชุมทดสอบ',
      meetingType: 'GENERAL',
      agendaText: 'วาระที่ 1 การเตรียมงาน',
      participants: [{ name: 'ครูสมชาย', roleLabel: 'ประธาน' }],
      markers: [
        { markerType: 'DECISION', timestampSec: 30, note: 'อนุมัติงบ' },
        { markerType: 'ACTION', timestampSec: 60, note: 'ทำรายงาน' },
      ],
      transcriptText: 'ที่ประชุมมีมติอนุมัติ',
    });

    expect(() => SummaryOutputSchema.parse(summary)).not.toThrow();
    expect(modelName).toBeTruthy();
    expect(promptVersion).toBeTruthy();
  });

  it('still satisfies the schema with no participants, agenda, or markers', async () => {
    const { summary } = await new MockSummarizationProvider().summarize({
      meetingId: 'm-2',
      title: 'ว่าง',
      meetingType: 'PLC',
      agendaText: null,
      participants: [],
      markers: [],
      transcriptText: '',
    });
    expect(() => SummaryOutputSchema.parse(summary)).not.toThrow();
  });
});

describe('MockTranscriptionProvider', () => {
  it('returns well-formed segments with non-decreasing, non-empty spans', async () => {
    const segments = await new MockTranscriptionProvider().transcribe({
      chunkId: 'c-1',
      chunkIndex: 0,
      filePath: 'meetings/m-1/chunks/c-1.m4a',
      durationSec: 300,
    });

    expect(segments.length).toBeGreaterThan(0);
    for (const s of segments) {
      expect(s.end).toBeGreaterThan(s.start);
      expect(s.text.trim()).not.toHaveLength(0);
    }
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].start).toBeGreaterThanOrEqual(segments[i - 1].start);
    }
  });
});

describe('jobId', () => {
  // BullMQ namespaces its Redis keys with ':' and rejects custom job ids that
  // contain one ("Custom Id cannot contain :"). A job id built with a colon
  // makes every enqueue throw at runtime, which no typecheck would catch.
  it('never emits a colon', () => {
    expect(jobId.transcribe('c-1')).not.toContain(':');
    expect(jobId.summarize('m-1')).not.toContain(':');
  });

  it('is deterministic so re-enqueueing the same work dedupes', () => {
    expect(jobId.transcribe('c-1')).toBe(jobId.transcribe('c-1'));
    expect(jobId.summarize('m-1')).toBe(jobId.summarize('m-1'));
  });

  it('separates the two queues so a chunk and a meeting never collide', () => {
    expect(jobId.transcribe('x')).not.toBe(jobId.summarize('x'));
  });

  it('embeds the id so a failed job can be traced back to its row', () => {
    expect(jobId.transcribe('chunk-abc')).toContain('chunk-abc');
    expect(jobId.summarize('meeting-abc')).toContain('meeting-abc');
  });
});

describe('meeting status constants', () => {
  it('treats READY, ARCHIVED and FAILED as terminal', () => {
    expect(TERMINAL_STATUSES).toEqual(
      expect.arrayContaining([
        PrismaMeetingStatus.READY,
        PrismaMeetingStatus.ARCHIVED,
        PrismaMeetingStatus.FAILED,
      ]),
    );
  });

  it('never lists an in-flight status as terminal', () => {
    for (const s of [
      PrismaMeetingStatus.RECORDING,
      PrismaMeetingStatus.UPLOADING,
      PrismaMeetingStatus.TRANSCRIBING,
    ]) {
      expect(TERMINAL_STATUSES).not.toContain(s);
    }
  });

  it('adds SUMMARIZING to the "do not move backwards" guard', () => {
    // transcribe.ts uses this to avoid flipping a meeting back to TRANSCRIBING
    // after a sibling chunk already advanced it to summarisation.
    expect(TERMINAL_OR_LATER_STATUSES).toContain(PrismaMeetingStatus.SUMMARIZING);
    for (const s of TERMINAL_STATUSES) {
      expect(TERMINAL_OR_LATER_STATUSES).toContain(s);
    }
  });
});

describe('shared enums stay aligned with Prisma', () => {
  // Worker code mixes @msec/shared enums with Prisma-generated ones; a drift
  // between them silently breaks status comparisons at runtime.
  it('has the same MeetingStatus members on both sides', () => {
    expect(Object.keys(MeetingStatus).sort()).toEqual(Object.keys(PrismaMeetingStatus).sort());
  });

  it('exposes the queue names the worker subscribes to', () => {
    expect(Object.values(QueueName)).toEqual(
      expect.arrayContaining(['transcribe', 'summarize', 'sweep']),
    );
  });
});
