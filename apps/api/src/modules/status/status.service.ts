import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { MeetingStatus, QueueName, jobId } from '@msec/shared';
import { JobStatus as PrismaJobStatus } from '@prisma/client';

@Injectable()
export class StatusService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueName.SUMMARIZE) private readonly summarizeQueue: Queue,
    @InjectQueue(QueueName.TRANSCRIBE) private readonly transcribeQueue: Queue,
  ) {}

  async getStatus(meetingId: string, orgId: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, organizationId: orgId },
      select: { id: true, status: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    const chunks = await this.prisma.audioChunk.groupBy({
      by: ['transcribeStatus', 'uploadStatus'],
      where: { meetingId },
      _count: { _all: true },
    });

    let total = 0;
    let uploaded = 0;
    let transcribed = 0;
    let failed = 0;
    for (const c of chunks) {
      total += c._count._all;
      if (c.uploadStatus === 'UPLOADED' || c.uploadStatus === 'TRANSCRIBED' || c.uploadStatus === 'DONE') {
        uploaded += c._count._all;
      }
      if (c.transcribeStatus === PrismaJobStatus.COMPLETED) transcribed += c._count._all;
      if (c.transcribeStatus === PrismaJobStatus.FAILED) failed += c._count._all;
    }

    const summary = await this.prisma.meetingSummary.findUnique({
      where: { meetingId },
      select: { id: true },
    });

    return {
      meetingStatus: meeting.status as MeetingStatus,
      chunks: { total, uploaded, transcribed, failed },
      summaryStatus: summary
        ? ('completed' as const)
        : meeting.status === 'SUMMARIZING'
          ? ('processing' as const)
          : ('pending' as const),
    };
  }

  async forceProcess(meetingId: string, orgId: string) {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, organizationId: orgId },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    // Clear failureReason at the moment of retry so the UI banner clears
    // immediately. The worker will reset it again on the first chunk anyway,
    // but doing it here means the user sees the meeting move out of FAILED
    // before the worker even picks the job up.
    if (meeting.failureReason) {
      await this.prisma.meeting.update({
        where: { id: meetingId },
        data: { failureReason: null },
      });
    }

    // re-enqueue every PENDING/FAILED chunk
    const chunks = await this.prisma.audioChunk.findMany({
      where: { meetingId, transcribeStatus: { in: [PrismaJobStatus.PENDING, PrismaJobStatus.FAILED] } },
      select: { id: true, filePath: true },
    });
    for (const ch of chunks) {
      await this.transcribeQueue.add(
        'transcribe-chunk',
        { chunkId: ch.id, meetingId, key: ch.filePath },
        {
          jobId: jobId.transcribe(ch.id),
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
    }

    // also queue a summary attempt — worker will short-circuit if not ready
    await this.summarizeQueue.add(
      'summarize-meeting',
      { meetingId },
      {
        jobId: jobId.summarize(meetingId),
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    return { reQueued: chunks.length };
  }

}
