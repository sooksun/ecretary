import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { HealthModule } from './modules/health/health.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { AudioChunksModule } from './modules/audio-chunks/audio-chunks.module';
import { MarkersModule } from './modules/markers/markers.module';
import { StatusModule } from './modules/status/status.module';
import { TranscriptsModule } from './modules/transcripts/transcripts.module';
import { SummariesModule } from './modules/summaries/summaries.module';
import { ActionItemsModule } from './modules/action-items/action-items.module';
import { ExportsModule } from './modules/exports/exports.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { RolesGuard } from './modules/auth/roles.guard';
import { MetricsModule } from './modules/metrics/metrics.module';
import { ApiCacheModule } from './common/cache/cache.module';
import { AuditModule } from './common/audit/audit.module';
import { QueueName } from '@msec/shared';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    BullModule.registerQueue(
      { name: QueueName.TRANSCRIBE },
      { name: QueueName.SUMMARIZE },
      { name: QueueName.SWEEP },
    ),
    ApiCacheModule,
    AuditModule,
    PrismaModule,
    StorageModule,
    AuthModule,
    HealthModule,
    MeetingsModule,
    AudioChunksModule,
    MarkersModule,
    StatusModule,
    TranscriptsModule,
    SummariesModule,
    ActionItemsModule,
    ExportsModule,
    NotificationsModule,
    MetricsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
