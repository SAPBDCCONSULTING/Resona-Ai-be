import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type {
  CampaignType,
  SessionStatus,
  SessionType,
} from '@pulsefeedback/shared';

export class CreateCampaignDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsEnum(['recurring', 'linked', 'independent'])
  type!: CampaignType;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cadence?: string | null;

  @IsOptional()
  @IsString()
  sessionTemplateId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  sessionCount?: number;

  @IsOptional()
  @IsEnum(['one_on_one', 'survey'])
  sessionType?: SessionType;

  @IsOptional()
  @IsString()
  startAt?: string | null;

  @IsOptional()
  @IsString()
  endAt?: string | null;
}

export class UpdateCampaignDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cadence?: string | null;

  @IsOptional()
  @IsString()
  startAt?: string | null;

  @IsOptional()
  @IsString()
  endAt?: string | null;

  @IsOptional()
  @IsEnum(['draft', 'scheduled', 'ongoing', 'completed', 'archived'])
  status?: SessionStatus;

  @IsOptional()
  @IsString()
  sessionTemplateId?: string | null;
}

export class LaunchCampaignDto {
  @IsOptional()
  @IsString()
  startAt?: string | null;

  @IsOptional()
  @IsString()
  endAt?: string | null;
}
