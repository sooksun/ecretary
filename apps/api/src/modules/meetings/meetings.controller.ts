import { Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { MeetingsService } from './meetings.service';
import { CreateMeetingSchema, UpdateMeetingSchema } from '@msec/shared';
import { ZBody } from '../../common/zod-body.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';

@Controller('meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Post()
  async create(
    @ZBody(CreateMeetingSchema) body: import('@msec/shared').CreateMeetingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.create(body, user);
  }

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.meetings.list({ status, q, from, to }, user!.organizationId);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.meetings.getById(id, user.organizationId);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @ZBody(UpdateMeetingSchema) body: import('@msec/shared').UpdateMeetingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.meetings.update(id, body, user.organizationId);
  }

  @Post(':id/start')
  async start(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.meetings.start(id, user.organizationId);
  }

  @Post(':id/end')
  async end(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.meetings.end(id, user.organizationId);
  }
}
