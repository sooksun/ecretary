import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AudioChunksService } from './audio-chunks.service';
import { ChunkUploadStatus, UploadChunkMetaSchema } from '@msec/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { z } from 'zod';

const PatchChunkStatusSchema = z.object({
  status: z.enum([
    ChunkUploadStatus.LOCAL_ONLY,
    ChunkUploadStatus.QUEUED,
    ChunkUploadStatus.UPLOADING,
    ChunkUploadStatus.UPLOADED,
    ChunkUploadStatus.PROCESSING,
    ChunkUploadStatus.TRANSCRIBED,
    ChunkUploadStatus.FAILED_RETRY,
    ChunkUploadStatus.FAILED_FINAL,
    ChunkUploadStatus.DONE,
  ]),
});

@Controller()
export class AudioChunksController {
  constructor(private readonly chunks: AudioChunksService) {}

  @Post('meetings/:id/audio-chunks')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: Number(process.env.MAX_CHUNK_SIZE_MB ?? 50) * 1024 * 1024,
      },
    }),
  )
  async upload(
    @Param('id') meetingId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) throw new BadRequestException('file is required (multipart field "file")');
    const meta = new ZodValidationPipe(UploadChunkMetaSchema).transform(body);
    return this.chunks.upload(meetingId, meta, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    }, user.organizationId);
  }

  @Get('meetings/:id/audio-chunks')
  async list(@Param('id') meetingId: string, @CurrentUser() user: AuthUser) {
    return this.chunks.listForMeeting(meetingId, user.organizationId);
  }

  @Patch('audio-chunks/:id/status')
  async patchStatus(
    @Param('id') chunkId: string,
    @Body(new ZodValidationPipe(PatchChunkStatusSchema))
    body: z.infer<typeof PatchChunkStatusSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chunks.setStatus(chunkId, body.status, user.organizationId);
  }
}
