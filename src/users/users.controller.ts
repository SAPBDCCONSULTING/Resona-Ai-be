import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../auth/permissions.guard';
import type { Caller } from '../roles/role-authority.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  list(@Req() req: Request & { user: Caller }) {
    return this.users.list(req.user);
  }

  /** Roles the caller is allowed to assign (org-scoped, within their own authority). */
  @Get('assignable-roles')
  @RequirePermissions('users:write')
  assignableRoles(@Req() req: Request & { user: Caller }) {
    return this.users.assignableRoles(req.user);
  }

  @Patch(':id/role')
  @RequirePermissions('users:write')
  assignRole(
    @Req() req: Request & { user: Caller },
    @Param('id') id: string,
    @Body() dto: AssignRoleDto,
  ) {
    return this.users.assignRole(req.user, id, dto.roleId);
  }
}
