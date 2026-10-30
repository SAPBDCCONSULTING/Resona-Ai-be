import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  SURVEY_RESPONSE_TYPES,
  type CreateEntryMode,
  type SessionStatus,
  type SessionType,
  type SurveyResponseType,
  type WizardStep,
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

  /** Survey questions only — sent when a session starts from a template. */
  @IsOptional()
  @IsIn(SURVEY_RESPONSE_TYPES)
  responseType?: SurveyResponseType;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  options?: string[];
}

class InvitationDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  header?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;
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

  @IsOptional()
  @IsString()
  @MaxLength(200)
  participantTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  participantDescription?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  welcomeMessage?: string | null;

  @IsOptional()
  @IsBoolean()
  anonymous?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => InvitationDto)
  invitation?: InvitationDto;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  engagementMetrics?: string[];
}
