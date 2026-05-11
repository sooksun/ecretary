import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SummariesController } from './summaries.controller';
import { SummariesService } from './summaries.service';
import { QueueName } from '@msec/shared';

@Module({
  imports: [BullModule.registerQueue({ name: QueueName.SUMMARIZE })],
  controllers: [SummariesController],
  providers: [SummariesService],
})
export class SummariesModule {}
