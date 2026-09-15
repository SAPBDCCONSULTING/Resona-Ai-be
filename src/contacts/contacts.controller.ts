import { Body, Controller, Get, Header, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { IsString } from 'class-validator';
import type { Request, Response } from 'express';
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

  @Get('contacts/export')
  @RequirePermissions('contacts:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="contacts.csv"')
  async exportCsv(
    @Req() req: Request & { user: { orgId: string } },
    @Res() res: Response,
  ) {
    const csv = await this.contacts.exportCsv(req.user.orgId);
    res.send(csv);
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
