import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
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

@Controller('ai')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('session-topics')
  @RequirePermissions('ai:use')
  generateTopics(@Body() dto: GenerateTopicsDto) {
    return this.ai.generateTopics(dto);
  }
}
