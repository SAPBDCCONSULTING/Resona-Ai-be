import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { ContactsService } from './contacts.service';

class ImportCsvDto {
  @IsString()
  csv!: string;
}

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get('contacts')
  @RequirePermissions('contacts:read')
  list(
    @Req() req: Request & { user: { orgId: string } },
    @Query('search') search?: string,
    @Query('groupId') groupId?: string,
  ) {
    return this.contacts.listContacts(req.user.orgId, search, groupId);
  }

  @Get('groups')
  @RequirePermissions('contacts:read')
  groups(@Req() req: Request & { user: { orgId: string } }) {
    return this.contacts.listGroups(req.user.orgId);
  }

  @Post('contacts/import')
  @RequirePermissions('contacts:import')
  importCsv(
    @Req() req: Request & { user: { orgId: string } },
    @Body() dto: ImportCsvDto,
  ) {
    return this.contacts.importCsv(req.user.orgId, dto.csv);
  }
}
