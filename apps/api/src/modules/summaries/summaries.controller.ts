import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { SummariesService } from './summaries.service';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';

const RegenerateSchema = z.object({
  template: z.string().optional(),
  notes: z.string().optional(),
});

// Shares the "meetings" prefix with MeetingsController intentionally.
// Routes here are 3+ segments (/:meetingId/board, /:meetingId/summary, ...) so
// no conflict with MeetingsController's 2-segment /:id routes today.
// Do NOT add routes here that duplicate a method+path already in MeetingsController.
@Controller('meetings')
export class SummariesController {
  constructor(private readonly summaries: SummariesService) {}

  @Get(':meetingId/board')
  async board(@Param('meetingId') id: string, @CurrentUser() user: AuthUser) {
    return this.summaries.getBoard(id, user.organizationId);
  }

  @Get(':meetingId/summary')
  async summary(@Param('meetingId') id: string, @CurrentUser() user: AuthUser) {
    return this.summaries.getSummary(id, user.organizationId);
  }

  @Post(':meetingId/summary/regenerate')
  async regenerate(
    @Param('meetingId') id: string,
    @Body(new ZodValidationPipe(RegenerateSchema)) body: z.infer<typeof RegenerateSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.summaries.regenerate(id, body, user.organizationId);
  }
}
