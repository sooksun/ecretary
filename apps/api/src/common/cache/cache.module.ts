import { Global, Module } from '@nestjs/common';
import { ApiCacheService } from './cache.service';

@Global()
@Module({
  providers: [ApiCacheService],
  exports: [ApiCacheService],
})
export class ApiCacheModule {}
