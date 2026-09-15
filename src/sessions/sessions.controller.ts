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
import { IsOptional, IsString } from 'class-validator';
import type { Request } from 'express';
import type {
  SessionBoardFilter,
  SessionSortBy,
  SessionType,
} from '@pulsefeedback/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { AuthService } from '../auth/auth.service';
import { SessionsService } from './sessions.service';
import { CreateDraftDto, UpdateDraftDto } from './dto/session-draft.dto';

type AuthedRequest = Request & {
  user: { userId: string; orgId: string; permissions: string[] };
};

class LaunchDto {
  @IsOptional()
  @IsString()
  startAt?: string | null;

  @IsOptional()
  @IsString()
  endAt?: string | null;
}

@Controller('sessions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @RequirePermissions('sessions:read')
  list(
    @Req() req: AuthedRequest,
    @Query('type') type?: SessionType,
    @Query('filter') filter?: SessionBoardFilter,
    @Query('sortBy') sortBy?: SessionSortBy,
    @Query('search') search?: string,
  ) {
    return this.sessions.list({
      orgId: req.user.orgId,
      type,
      filter,
      sortBy,
      search,
    });
  }

  @Post('draft')
  @RequirePermissions('sessions:write')
  async createDraft(@Req() req: AuthedRequest, @Body() dto: CreateDraftDto) {
    const me = await this.auth.me(req.user.userId);
    return this.sessions.createDraft(
      { userId: me.id, orgId: me.orgId, name: me.name },
      dto,
    );
  }

  @Get(':id')
  @RequirePermissions('sessions:read')
  getOne(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.sessions.getOne(req.user.orgId, id);
  }

  @Patch(':id')
  @RequirePermissions('sessions:write')
  updateDraft(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateDraftDto,
  ) {
    return this.sessions.updateDraft(req.user.orgId, id, dto);
  }

  @Post(':id/launch')
  @RequirePermissions('sessions:launch')
  launch(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: LaunchDto,
  ) {
    return this.sessions.launch(req.user.orgId, id, dto);
  }
}

/** Public join info for employees-fe (no JWT). */
@Controller('public/sessions')
export class PublicSessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get(':id/join')
  joinInfo(@Param('id') id: string) {
    return this.sessions.getJoinInfo(id);
  }
}
