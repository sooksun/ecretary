import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ActionItemsService } from './action-items.service';
import { ActionStatus } from '@msec/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';

const CreateActionItemSchema = z.object({
  title: z.string().min(1).max(240),
  description: z.string().max(4000).optional().nullable(),
  assigneeName: z.string().max(120).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  evidenceRequired: z.string().max(2000).optional().nullable(),
  sourceTimestampSec: z.number().int().optional().nullable(),
  confidence: z.number().min(0).max(1).optional().nullable(),
});

const UpdateActionItemSchema = z.object({
  title: z.string().min(1).max(240).optional(),
  description: z.string().max(4000).optional().nullable(),
  assigneeName: z.string().max(120).optional().nullable(),
  dueDate: z.string().optional().nullable(),
  status: z
    .enum([
      ActionStatus.PENDING,
      ActionStatus.IN_PROGRESS,
      ActionStatus.DONE,
      ActionStatus.OVERDUE,
      ActionStatus.NEED_CLARIFICATION,
      ActionStatus.CANCELLED,
    ])
    .optional(),
  evidenceRequired: z.string().max(2000).optional().nullable(),
});

@Controller()
export class ActionItemsController {
  constructor(private readonly actions: ActionItemsService) {}

  @Get('meetings/:id/action-items')
  async list(
    @Param('id') meetingId: string,
    @Query('status') status?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.actions.list(meetingId, user!.organizationId, { status });
  }

  @Post('meetings/:id/action-items')
  async create(
    @Param('id') meetingId: string,
    @Body(new ZodValidationPipe(CreateActionItemSchema))
    body: z.infer<typeof CreateActionItemSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.actions.create(meetingId, body, user.organizationId);
  }

  @Patch('action-items/:id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateActionItemSchema))
    body: z.infer<typeof UpdateActionItemSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.actions.update(id, body, user.organizationId);
  }
}
