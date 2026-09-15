import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { AuthService } from '../auth/auth.service';
import { CampaignsService } from './campaigns.service';
import {
  CreateCampaignDto,
  LaunchCampaignDto,
  UpdateCampaignDto,
} from './dto/campaign.dto';

type AuthedRequest = Request & {
  user: { userId: string; orgId: string; permissions: string[] };
};

@Controller('campaigns')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermissions('campaigns:read')
  list(@Req() req: AuthedRequest) {
    return this.campaigns.list(req.user.orgId);
  }

  @Post()
  @RequirePermissions('campaigns:write')
  async create(@Req() req: AuthedRequest, @Body() dto: CreateCampaignDto) {
    const me = await this.auth.me(req.user.userId);
    return this.campaigns.create(
      { userId: me.id, orgId: me.orgId, name: me.name },
      dto,
    );
  }

  @Get(':id')
  @RequirePermissions('campaigns:read')
  getOne(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.campaigns.getOne(req.user.orgId, id);
  }

  @Patch(':id')
  @RequirePermissions('campaigns:write')
  update(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.campaigns.update(req.user.orgId, id, dto);
  }

  @Post(':id/launch')
  @RequirePermissions('campaigns:write')
  launch(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: LaunchCampaignDto,
  ) {
    return this.campaigns.launch(req.user.orgId, id, dto);
  }
}
