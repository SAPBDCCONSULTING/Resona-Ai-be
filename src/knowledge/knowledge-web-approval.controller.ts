import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { CreateWebApprovalDto } from './dto/web-approval.dto';
import { KnowledgeWebApprovalService } from './knowledge-web-approval.service';

type AuthedRequest = Request & { user: { userId: string; orgId: string } };

/**
 * Only kb:web_manage may create or revoke an entry — deliberately a
 * separate permission from kb:write/kb:publish, since approving an
 * outbound network destination for the whole org's AI pipeline is a
 * materially different, more sensitive capability than uploading a file.
 */
@Controller('knowledge/web-approvals')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeWebApprovalController {
  constructor(private readonly approvals: KnowledgeWebApprovalService) {}

  @Get()
  @RequirePermissions('kb:web_manage')
  list(@Req() req: AuthedRequest) {
    return this.approvals.list(req.user.orgId);
  }

  @Post()
  @RequirePermissions('kb:web_manage')
  create(@Req() req: AuthedRequest, @Body() dto: CreateWebApprovalDto) {
    return this.approvals.create(req.user.orgId, req.user.userId, dto);
  }

  @Delete(':id')
  @RequirePermissions('kb:web_manage')
  revoke(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.approvals.revoke(req.user.orgId, req.user.userId, id);
  }
}
