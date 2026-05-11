import { Controller, Get, Param } from '@nestjs/common';
import { TranscriptsService } from './transcripts.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';

@Controller('meetings/:id/transcript')
export class TranscriptsController {
  constructor(private readonly service: TranscriptsService) {}

  @Get()
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.list(id, user.organizationId);
  }
}
