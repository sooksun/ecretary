import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/**
 * Global like PrismaModule and ApiCacheModule: audit-worthy actions are spread
 * across feature modules, and requiring each to import an AuditModule would
 * make it easy to forget one.
 */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
