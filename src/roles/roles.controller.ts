import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../auth/permissions.guard';
import {
  CreateCustomRoleDto,
  UpdateCustomRoleDto,
} from './dto/custom-role.dto';
import { UpdateGrantsDto } from './dto/update-grants.dto';
import { CustomRolesService } from './custom-roles.service';
import type { Caller } from './role-authority.service';
import { RoleProfilesService } from './role-profiles.service';
import { RolesService } from './roles.service';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(
    private readonly roles: RolesService,
    private readonly profiles: RoleProfilesService,
    private readonly custom: CustomRolesService,
  ) {}

  @Get()
  @RequirePermissions('roles:read')
  list(@Req() req: Request & { user: { orgId: string } }) {
    return this.roles.list(req.user.orgId);
  }

  /** Granular role-profile directory. Configuration only — not enforced by the API yet. */
  @Get('profiles')
  @RequirePermissions('roles:read')
  listProfiles(@Req() req: Request & { user: Caller }) {
    return this.profiles.list(req.user);
  }

  @Patch('profiles/:profileKey/grants')
  @RequirePermissions('roles:write')
  updateProfileGrants(
    @Req() req: Request & { user: Caller },
    @Param('profileKey') profileKey: string,
    @Body() dto: UpdateGrantsDto,
  ) {
    return this.profiles.updateGrants(
      req.user,
      profileKey,
      dto.grants,
      dto.expectedVersion,
    );
  }

  /**
   * Custom roles. The guard checks the legacy permission from the JWT; the service re-checks it
   * (and everything else) against the database, because the JWT can be hours stale.
   */
  @Get('custom')
  @RequirePermissions('roles:read')
  listCustom(@Req() req: Request & { user: Caller }) {
    return this.custom.list(req.user);
  }

  @Post('custom')
  @RequirePermissions('roles:write')
  createCustom(
    @Req() req: Request & { user: Caller },
    @Body() dto: CreateCustomRoleDto,
  ) {
    return this.custom.create(req.user, dto);
  }

  @Patch('custom/:id')
  @RequirePermissions('roles:write')
  updateCustom(
    @Req() req: Request & { user: Caller },
    @Param('id') id: string,
    @Body() dto: UpdateCustomRoleDto,
  ) {
    return this.custom.update(req.user, id, dto, dto.expectedVersion);
  }

  @Delete('custom/:id')
  @RequirePermissions('roles:write')
  removeCustom(
    @Req() req: Request & { user: Caller },
    @Param('id') id: string,
  ) {
    return this.custom.remove(req.user, id);
  }
}
