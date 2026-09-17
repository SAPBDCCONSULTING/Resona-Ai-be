import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { UpdateOrgDto } from './dto/update-org.dto';
import { OrgService } from './org.service';

@Controller('org')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrgController {
  constructor(private readonly org: OrgService) {}

  @Get()
  @RequirePermissions('settings:read')
  get(@Req() req: Request & { user: { orgId: string } }) {
    return this.org.get(req.user.orgId);
  }

  @Patch()
  @RequirePermissions('settings:write')
  update(@Req() req: Request & { user: { orgId: string } }, @Body() dto: UpdateOrgDto) {
    return this.org.update(req.user.orgId, dto);
  }
}
