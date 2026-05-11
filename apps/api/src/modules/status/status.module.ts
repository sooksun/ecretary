import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';
import { QueueName } from '@msec/shared';

@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.SUMMARIZE }, { name: QueueName.TRANSCRIBE }),
  ],
  controllers: [StatusController],
  providers: [StatusService],
})
export class StatusModule {}
