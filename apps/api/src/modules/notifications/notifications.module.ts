import { Module } from '@nestjs/common';
import { LinePushService } from './line-push.service';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
  providers: [LinePushService],
  exports: [LinePushService],
})
export class NotificationsModule {}
