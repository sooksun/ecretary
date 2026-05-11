import { Controller, Get, Param, Post } from '@nestjs/common';
import { StatusService } from './status.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';

@Controller('meetings/:id')
export class StatusController {
  constructor(private readonly status: StatusService) {}

  @Get('status')
  async getStatus(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.status.getStatus(id, user.organizationId);
  }

  @Post('process')
  async forceProcess(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.status.forceProcess(id, user.organizationId);
  }
}
