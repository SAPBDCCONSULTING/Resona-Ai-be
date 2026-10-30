import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { PermissionKey } from '@pulsefeedback/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { ResolveKnowledgeFeedbackDto, SubmitKnowledgeFeedbackDto } from './dto/knowledge-feedback.dto';
import { KnowledgeFeedbackService } from './knowledge-feedback.service';

type AuthedRequest = Request & {
  user: { userId: string; orgId: string; permissions?: PermissionKey[] };
};

/**
 * Submitting feedback only needs the baseline ai:use permission (anyone
 * who can use the assistant can rate/report an answer). Per-item
 * list/resolve authorization beyond that is ownership-based
 * (ownerUserId === caller) and can't be expressed in static route
 * metadata, so it's enforced in the service layer — this guard only
 * establishes the manage-everything override (kb:feedback_manage).
 */
@Controller('knowledge/feedback')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KnowledgeFeedbackController {
  constructor(private readonly feedback: KnowledgeFeedbackService) {}

  private canManage(req: AuthedRequest): boolean {
    return req.user.permissions?.includes('kb:feedback_manage') ?? false;
  }

  @Post()
  @RequirePermissions('ai:use')
  submit(@Req() req: AuthedRequest, @Body() dto: SubmitKnowledgeFeedbackDto) {
    return this.feedback.submit(req.user.orgId, req.user.userId, dto);
  }

  @Get()
  @RequirePermissions('ai:use')
  list(@Req() req: AuthedRequest, @Query('status') status?: string) {
    return this.feedback.list(req.user.orgId, req.user.userId, this.canManage(req), { status });
  }

  @Patch(':id/resolve')
  @RequirePermissions('ai:use')
  resolve(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: ResolveKnowledgeFeedbackDto,
  ) {
    return this.feedback.resolve(req.user.orgId, req.user.userId, this.canManage(req), id, dto);
  }
}
