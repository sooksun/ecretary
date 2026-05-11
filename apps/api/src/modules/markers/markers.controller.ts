import { Controller, Get, Param, Post } from '@nestjs/common';
import { MarkersService } from './markers.service';
import { CreateMarkerSchema } from '@msec/shared';
import { ZBody } from '../../common/zod-body.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';

@Controller('meetings/:id/markers')
export class MarkersController {
  constructor(private readonly markers: MarkersService) {}

  @Post()
  async create(
    @Param('id') meetingId: string,
    @ZBody(CreateMarkerSchema) body: import('@msec/shared').CreateMarkerDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.markers.create(meetingId, body, user.organizationId);
  }

  @Get()
  async list(@Param('id') meetingId: string, @CurrentUser() user: AuthUser) {
    return this.markers.list(meetingId, user.organizationId);
  }
}
