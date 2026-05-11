import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import {
  ChunkUploadResponse,
  QueueName,
  ChunkUploadStatus as SharedChunkStatus,
  UploadChunkMetaDto,
} from '@msec/shared';
import {
  ChunkUploadStatus,
  JobStatus,
  Prisma,
} from '@prisma/client';

export interface ChunkFileInput {
  buffer: Buffer;
  originalname?: string;
  mimetype?: string;
  size: number;
}

@Injectable()
export class AudioChunksService {
  private readonly logger = new Logger(AudioChunksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(QueueName.TRANSCRIBE) private readonly transcribeQueue: Queue,
  ) {}

  async upload(
    meetingId: string,
    meta: UploadChunkMetaDto,
    file: ChunkFileInput,
    orgId: string,
  ): Promise<ChunkUploadResponse> {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, organizationId: orgId },
      select: { id: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');

    // Idempotent: same clientChunkId → return existing
    const existing = await this.prisma.audioChunk.findUnique({
      where: { clientChunkId: meta.clientChunkId },
      select: { id: true, uploadStatus: true, meetingId: true },
    });
    if (existing) {
      if (existing.meetingId !== meetingId) {
        throw new BadRequestException('clientChunkId belongs to a different meeting');
      }
      return {
        chunkId: existing.id,
        status: existing.uploadStatus as SharedChunkStatus,
        alreadyExists: true,
      };
    }

    if (file.size <= 0) {
      throw new BadRequestException('Empty file');
    }

    // Verify checksum if client provided one
    if (meta.checksumSha256) {
      const computed = createHash('sha256').update(file.buffer).digest('hex');
      if (computed.toLowerCase() !== meta.checksumSha256.toLowerCase()) {
        throw new BadRequestException('Checksum mismatch');
      }
    }

    const ext = this.guessExtension(file.mimetype, file.originalname);
    const key = this.storage.buildChunkKey(meetingId, meta.clientChunkId, ext);
    await this.storage.putObject({
      key,
      body: file.buffer,
      contentType: file.mimetype ?? meta.mimeType,
      contentLength: file.size,
    });

    const created = await this.prisma.audioChunk.create({
      data: {
        meetingId,
        clientChunkId: meta.clientChunkId,
        chunkIndex: meta.chunkIndex,
        filePath: key,
        mimeType: meta.mimeType ?? file.mimetype ?? null,
        durationSec: meta.durationSec ?? null,
        fileSizeBytes: BigInt(file.size),
        checksumSha256: meta.checksumSha256 ?? null,
        uploadStatus: ChunkUploadStatus.UPLOADED,
        transcribeStatus: JobStatus.PENDING,
        startedAtSec: meta.startedAtSec ?? null,
        endedAtSec: meta.endedAtSec ?? null,
        uploadedAt: new Date(),
      },
    });

    // Enqueue transcription job (worker runs separately)
    await this.transcribeQueue.add(
      'transcribe-chunk',
      { chunkId: created.id, meetingId, key },
      {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );

    return {
      chunkId: created.id,
      status: created.uploadStatus as SharedChunkStatus,
      alreadyExists: false,
    };
  }

  async listForMeeting(meetingId: string, orgId: string) {
    await this.assertMeetingInOrg(meetingId, orgId);
    return this.prisma.audioChunk.findMany({
      where: { meetingId },
      orderBy: { chunkIndex: 'asc' },
      select: {
        id: true,
        clientChunkId: true,
        chunkIndex: true,
        uploadStatus: true,
        transcribeStatus: true,
        durationSec: true,
        fileSizeBytes: true,
        startedAtSec: true,
        endedAtSec: true,
        retryCount: true,
        lastError: true,
        createdAt: true,
        uploadedAt: true,
      },
    });
  }

  async setStatus(chunkId: string, status: SharedChunkStatus, orgId: string) {
    const chunk = await this.prisma.audioChunk.findUnique({
      where: { id: chunkId },
      select: { meetingId: true },
    });
    if (!chunk) throw new NotFoundException('Chunk not found');
    await this.assertMeetingInOrg(chunk.meetingId, orgId);
    try {
      return await this.prisma.audioChunk.update({
        where: { id: chunkId },
        data: { uploadStatus: status as ChunkUploadStatus },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException('Chunk not found');
      }
      throw err;
    }
  }

  private async assertMeetingInOrg(meetingId: string, orgId: string): Promise<void> {
    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, organizationId: orgId },
      select: { id: true },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
  }

  private guessExtension(mime?: string, originalName?: string): string {
    if (originalName) {
      const idx = originalName.lastIndexOf('.');
      if (idx > -1 && idx < originalName.length - 1) return originalName.slice(idx + 1).toLowerCase();
    }
    if (!mime) return 'm4a';
    if (mime.includes('mp4')) return 'm4a';
    if (mime.includes('aac')) return 'aac';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('wav')) return 'wav';
    return 'bin';
  }
}
