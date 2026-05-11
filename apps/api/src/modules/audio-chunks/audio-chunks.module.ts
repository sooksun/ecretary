import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AudioChunksController } from './audio-chunks.controller';
import { AudioChunksService } from './audio-chunks.service';
import { StorageModule } from '../../storage/storage.module';
import { QueueName } from '@msec/shared';

@Module({
  imports: [
    StorageModule,
    BullModule.registerQueue({ name: QueueName.TRANSCRIBE }),
  ],
  controllers: [AudioChunksController],
  providers: [AudioChunksService],
  exports: [AudioChunksService],
})
export class AudioChunksModule {}
