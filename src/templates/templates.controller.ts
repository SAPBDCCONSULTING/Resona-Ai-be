import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsEnum,
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
import { TemplatesService } from './templates.service';

class TopicDto {
  @IsString()
  id!: string;

  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  order?: number;
}

class CreateSessionTemplateDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsEnum(['one_on_one', 'survey'])
  sessionType!: SessionType;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  goalPrompt?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TopicDto)
  topics?: TopicDto[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tone?: string | null;
}

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}

  @Get('report-templates')
  @RequirePermissions('templates:read')
  listReportTemplates(
    @Req() req: Request & { user: { orgId: string } },
    @Query('sessionType') sessionType?: SessionType,
  ) {
    return this.templates.listReportTemplates(req.user.orgId, sessionType);
  }

  @Get('session-templates')
  @RequirePermissions('templates:read')
  listSessionTemplates(
    @Req() req: Request & { user: { orgId: string } },
    @Query('sessionType') sessionType?: SessionType,
  ) {
    return this.templates.listSessionTemplates(req.user.orgId, sessionType);
  }

  @Post('session-templates')
  @RequirePermissions('templates:write')
  createSessionTemplate(
    @Req() req: Request & { user: { orgId: string } },
    @Body() dto: CreateSessionTemplateDto,
  ) {
    return this.templates.createSessionTemplate(req.user.orgId, {
      ...dto,
      topics: dto.topics?.map((t, i) => ({
        id: t.id,
        title: t.title,
        order: t.order ?? i + 1,
      })),
    });
  }
}
