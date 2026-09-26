import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { ConversationChatDto } from './dto/conversation-chat.dto';
import { ConversationsService } from './conversations.service';

type AuthedRequest = Request & {
  user: { userId: string; orgId: string };
};

@Controller('sessions/:id/conversations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get('mine')
  @RequirePermissions('sessions:read')
  getMine(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.conversations.getMine(id, {
      userId: req.user.userId,
      orgId: req.user.orgId,
    });
  }

  @Post('start')
  @RequirePermissions('responses:write')
  start(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.conversations.start(id, {
      userId: req.user.userId,
      orgId: req.user.orgId,
    });
  }

  @Post('chat')
  @RequirePermissions('responses:write')
  chat(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: ConversationChatDto,
  ) {
    return this.conversations.chat(
      id,
      { userId: req.user.userId, orgId: req.user.orgId },
      dto.message,
    );
  }
}
