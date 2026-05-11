import { Module } from '@nestjs/common';
import { ActionItemsController } from './action-items.controller';
import { ActionItemsService } from './action-items.service';

@Module({
  controllers: [ActionItemsController],
  providers: [ActionItemsService],
})
export class ActionItemsModule {}
