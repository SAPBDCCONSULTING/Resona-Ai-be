import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsString } from 'class-validator';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { ContactsService } from './contacts.service';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';
import { AddGroupMembersDto, CreateGroupDto, UpdateGroupDto } from './dto/group.dto';

type AuthedRequest = Request & { user: { orgId: string } };

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

  // NOTE: routes below are declared after 'contacts/export' on purpose —
  // 'contacts/:id' would otherwise match the literal '/contacts/export' path.

  @Post('contacts')
  @RequirePermissions('contacts:write')
  createContact(@Req() req: AuthedRequest, @Body() dto: CreateContactDto) {
    return this.contacts.createContact(req.user.orgId, dto);
  }

  @Get('contacts/:id')
  @RequirePermissions('contacts:read')
  getContact(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.contacts.getContact(req.user.orgId, id);
  }

  @Patch('contacts/:id')
  @RequirePermissions('contacts:write')
  updateContact(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contacts.updateContact(req.user.orgId, id, dto);
  }

  @Delete('contacts/:id')
  @RequirePermissions('contacts:write')
  deleteContact(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.contacts.deleteContact(req.user.orgId, id);
  }

  @Post('groups')
  @RequirePermissions('contacts:write')
  createGroup(@Req() req: AuthedRequest, @Body() dto: CreateGroupDto) {
    return this.contacts.createGroup(req.user.orgId, dto);
  }

  @Patch('groups/:id')
  @RequirePermissions('contacts:write')
  updateGroup(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateGroupDto,
  ) {
    return this.contacts.updateGroup(req.user.orgId, id, dto);
  }

  @Delete('groups/:id')
  @RequirePermissions('contacts:write')
  deleteGroup(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.contacts.deleteGroup(req.user.orgId, id);
  }

  @Post('groups/:id/members')
  @RequirePermissions('contacts:write')
  addGroupMembers(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: AddGroupMembersDto,
  ) {
    return this.contacts.addGroupMembers(req.user.orgId, id, dto.contactIds);
  }

  @Delete('groups/:id/members/:cid')
  @RequirePermissions('contacts:write')
  removeGroupMember(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Param('cid') cid: string,
  ) {
    return this.contacts.removeGroupMember(req.user.orgId, id, cid);
  }
}
