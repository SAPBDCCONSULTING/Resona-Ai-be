import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { SessionType } from '@pulsefeedback/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { TemplatesService } from './templates.service';

@Controller('report-templates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get()
  @RequirePermissions('templates:read')
  list(
    @Req() req: Request & { user: { orgId: string } },
    @Query('sessionType') sessionType?: SessionType,
  ) {
    return this.templates.list(req.user.orgId, sessionType);
  }
}
