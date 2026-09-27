import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  CreateEntryMode,
  SessionStatus,
  SessionType,
  WizardStep,
} from '@pulsefeedback/shared';

export class CreateDraftDto {
  @IsOptional()
  @IsEnum(['one_on_one', 'survey'])
  type?: SessionType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsEnum(['blank', 'goal_first', 'quick_create'])
  entryMode?: CreateEntryMode;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  goalPrompt?: string | null;

  @IsOptional()
  @IsEnum([
    'choose_type',
    'describe',
    'verify',
    'participants',
    'reports',
    'schedule',
  ])
  wizardStep?: WizardStep;
}

class TopicDto {
  @IsString()
  id!: string;

  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  order?: number;
}

export class UpdateDraftDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsEnum(['one_on_one', 'survey'])
  type?: SessionType;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  goalPrompt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tone?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TopicDto)
  topics?: TopicDto[];

  @IsOptional()
  @IsEnum([
    'choose_type',
    'describe',
    'verify',
    'participants',
    'reports',
    'schedule',
  ])
  wizardStep?: WizardStep;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participantIds?: string[];

  @IsOptional()
  @IsString()
  reportTemplateId?: string | null;

  @IsOptional()
  @IsString()
  startAt?: string | null;

  @IsOptional()
  @IsString()
  endAt?: string | null;

  @IsOptional()
  @IsEnum(['draft', 'scheduled', 'ongoing', 'completed', 'archived'])
  status?: SessionStatus;
}
