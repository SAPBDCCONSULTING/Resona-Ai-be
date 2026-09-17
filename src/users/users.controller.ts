import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { AssignRoleDto } from './dto/assign-role.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users:read')
  list(@Req() req: Request & { user: { orgId: string } }) {
    return this.users.list(req.user.orgId);
  }

  @Patch(':id/role')
  @RequirePermissions('users:write')
  assignRole(
    @Req() req: Request & { user: { orgId: string } },
    @Param('id') id: string,
    @Body() dto: AssignRoleDto,
  ) {
    return this.users.assignRole(req.user.orgId, id, dto.roleId);
  }
}
