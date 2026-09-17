import { Body, Controller, Post, UseGuards } from '@nestjs/common';
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
import type { SessionType } from '@pulsefeedback/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard, RequirePermissions } from '../auth/permissions.guard';
import { AiService } from './ai.service';

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
  constructor(private readonly ai: AiService) {}

  @Post('session-topics')
  @RequirePermissions('ai:use')
  generateTopics(@Body() dto: GenerateTopicsDto) {
    return this.ai.generateTopics(dto);
  }

  @Post('session-chat')
  @RequirePermissions('ai:use')
  sessionChat(@Body() dto: SessionChatTurnDto) {
    return this.ai.chatDescribeTurn(dto);
  }

  @Post('assistant-chat')
  @RequirePermissions('ai:use')
  assistantChat(@Body() dto: AssistantChatTurnDto) {
    return this.ai.assistantChatTurn(dto);
  }
}
