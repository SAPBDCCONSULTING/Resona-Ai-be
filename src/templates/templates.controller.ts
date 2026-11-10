import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SessionType } from '@pulsefeedback/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../auth/permissions.guard';
import {
  CreateSessionTemplateDto,
  DuplicateSessionTemplateDto,
  ListSessionTemplatesQueryDto,
  UpdateSessionTemplateDto,
} from './dto/session-template.dto';
import { TemplatesService } from './templates.service';

type AuthedRequest = Request & { user: { orgId: string; userId: string } };

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('report-templates')
  @RequirePermissions('templates:read')
  listReportTemplates(
    @Req() req: AuthedRequest,
    @Query('sessionType') sessionType?: SessionType,
  ) {
    return this.templates.listReportTemplates(req.user.orgId, sessionType);
  }

  /** Published templates by default; pass `status=draft|archived|all` for others. */
  @Get('session-templates')
  @RequirePermissions('templates:read')
  listSessionTemplates(
    @Req() req: AuthedRequest,
    @Query() query: ListSessionTemplatesQueryDto,
  ) {
    return this.templates.listSessionTemplates(req.user, query);
  }

  @Get('session-templates/:id')
  @RequirePermissions('templates:read')
  getSessionTemplate(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.templates.getSessionTemplate(req.user, id);
  }

  @Post('session-templates')
  @RequirePermissions('templates:write')
  createSessionTemplate(
    @Req() req: AuthedRequest,
    @Body() dto: CreateSessionTemplateDto,
  ) {
    return this.templates.createSessionTemplate(req.user, dto);
  }

  /** System templates are read-only (403) — duplicate them instead. */
  @Patch('session-templates/:id')
  @RequirePermissions('templates:write')
  updateSessionTemplate(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateSessionTemplateDto,
  ) {
    return this.templates.updateSessionTemplate(req.user, id, dto);
  }

  @Post('session-templates/:id/duplicate')
  @RequirePermissions('templates:write')
  duplicateSessionTemplate(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: DuplicateSessionTemplateDto,
  ) {
    return this.templates.duplicateSessionTemplate(req.user, id, dto);
  }
}
