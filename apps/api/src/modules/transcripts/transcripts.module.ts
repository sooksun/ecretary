import { Module } from '@nestjs/common';
import { TranscriptsController } from './transcripts.controller';
import { TranscriptsService } from './transcripts.service';

@Module({
  controllers: [TranscriptsController],
  providers: [TranscriptsService],
})
export class TranscriptsModule {}
