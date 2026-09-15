import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { SubmitResponseDto } from './dto/submit-response.dto';
import { ResponsesService } from './responses.service';

type AuthedRequest = Request & {
  user: { userId: string; orgId: string };
};

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ResponsesController {
  constructor(private readonly responses: ResponsesService) {}

  @Get('me/assignments')
  @RequirePermissions('sessions:read')
  listMine(@Req() req: AuthedRequest) {
    return this.responses.listAssignments(req.user.userId, req.user.orgId);
  }

  @Get('sessions/:id/responses/mine')
  @RequirePermissions('sessions:read')
  getMine(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.responses.getMine(id, req.user.userId);
  }

  @Post('sessions/:id/responses')
  @RequirePermissions('responses:write')
  submit(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: SubmitResponseDto,
  ) {
    return this.responses.submit(id, { userId: req.user.userId, orgId: req.user.orgId }, dto);
  }
}
