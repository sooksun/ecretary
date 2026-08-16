import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ExportsService } from './exports.service';
import { ExportType } from '@msec/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';

const CreateExportSchema = z.object({
  exportType: z.enum([ExportType.PDF, ExportType.DOCX, ExportType.TRANSCRIPT_TXT]),
  template: z.string().optional(),
});

@Controller()
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Post('meetings/:id/exports')
  async create(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateExportSchema)) body: z.infer<typeof CreateExportSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.exports.create(id, body.exportType, user.organizationId, body.template, user.id);
  }

  @Get('meetings/:id/exports')
  async list(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.exports.list(id, user.organizationId, user.id);
  }

  @Get('exports/:id')
  async detail(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.exports.getById(id, user.organizationId, user.id);
  }
}
