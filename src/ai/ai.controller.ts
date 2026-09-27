import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Request } from 'express';
import type { SessionType } from '@pulsefeedback/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  PermissionsGuard,
  RequirePermissions,
} from '../auth/permissions.guard';
import { AiService } from './ai.service';
import { KnowledgeBaseService } from './knowledge/knowledge-base.service';

type AuthedRequest = Request & { user: { userId: string; orgId: string } };

class GenerateTopicsDto {
  @IsString()
  @MaxLength(4000)
  goalPrompt!: string;

  @IsEnum(['one_on_one', 'survey'])
  type!: SessionType;

  @IsOptional()
  @IsString()
  tone?: string | null;

  @IsOptional()
  @IsString()
  title?: string | null;
}

class SessionChatMessageDto {
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @IsString()
  @MaxLength(2000)
  content!: string;
}

class SessionChatTurnDto {
  @IsEnum(['one_on_one', 'survey'])
  type!: SessionType;

  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => SessionChatMessageDto)
  messages!: SessionChatMessageDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;
}

class AssistantChatTurnDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => SessionChatMessageDto)
  messages!: SessionChatMessageDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  pageHint?: string | null;
}

@Controller('ai')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly kb: KnowledgeBaseService,
  ) {}

  /** Inspect curated knowledge articles used by AI chat. */
  @Get('knowledge')
  @RequirePermissions('ai:use')
  listKnowledge() {
    const articles = this.kb.listAll();
    return {
      articles: articles.map((a) => ({
        id: a.id,
        title: a.title,
        surfaces: a.surfaces,
        keywords: a.keywords,
      })),
      count: articles.length,
    };
  }

  @Post('session-topics')
  @RequirePermissions('ai:use')
  generateTopics(@Req() req: AuthedRequest, @Body() dto: GenerateTopicsDto) {
    return this.ai.generateTopics(dto, req.user.orgId);
  }

  @Post('session-chat')
  @RequirePermissions('ai:use')
  sessionChat(@Req() req: AuthedRequest, @Body() dto: SessionChatTurnDto) {
    return this.ai.chatDescribeTurn(dto, req.user.orgId);
  }

  @Post('assistant-chat')
  @RequirePermissions('ai:use')
  assistantChat(@Req() req: AuthedRequest, @Body() dto: AssistantChatTurnDto) {
    return this.ai.assistantChatTurn(dto, req.user.orgId);
  }
}
