import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  SESSION_TEMPLATE_STATUSES,
  SURVEY_RESPONSE_TYPES,
  type SessionTemplateStatus,
  type SessionTemplateVisibility,
  type SessionType,
  type SurveyResponseType,
} from '@pulsefeedback/shared';

const SESSION_TYPES: SessionType[] = ['one_on_one', 'survey'];
/** `system` is reserved for built-in templates and can't be set by users. */
const USER_VISIBILITIES: SessionTemplateVisibility[] = [
  'organization',
  'private',
];
/** New templates and copies can't start out archived. */
const CREATE_STATUSES: SessionTemplateStatus[] = ['draft', 'published'];

/** Trimmed before validation so whitespace-only names fail. */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class TemplateTopicDto {
  @IsString()
  @MaxLength(50)
  id!: string;

  @IsString()
  @MaxLength(300)
  title!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;

  /** Survey questions only. */
  @IsOptional()
  @IsIn(SURVEY_RESPONSE_TYPES)
  responseType?: SurveyResponseType;

  /** Choices for multiple_choice, or scale labels (low → high). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  options?: string[];
}

/** Metadata shared by create and update. */
class TemplateMetadataDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  audience?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(480)
  estimatedDurationMinutes?: number;

  @IsOptional()
  @IsIn(USER_VISIBILITIES)
  visibility?: Exclude<SessionTemplateVisibility, 'system'>;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  rolloutSuggestion?: string;
}

export class CreateSessionTemplateDto extends TemplateMetadataDto {
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsIn(SESSION_TYPES)
  sessionType!: SessionType;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  goalPrompt?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TemplateTopicDto)
  topics?: TemplateTopicDto[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tone?: string | null;

  @IsOptional()
  @IsIn(CREATE_STATUSES)
  status?: Exclude<SessionTemplateStatus, 'archived'>;
}

export class UpdateSessionTemplateDto extends TemplateMetadataDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsIn(SESSION_TYPES)
  sessionType?: SessionType;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  goalPrompt?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => TemplateTopicDto)
  topics?: TemplateTopicDto[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tone?: string | null;

  /** Set to `archived` to retire a template, or back to draft/published. */
  @IsOptional()
  @IsIn(SESSION_TEMPLATE_STATUSES)
  status?: SessionTemplateStatus;
}

export class DuplicateSessionTemplateDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIn(USER_VISIBILITIES)
  visibility?: Exclude<SessionTemplateVisibility, 'system'>;

  @IsOptional()
  @IsIn(CREATE_STATUSES)
  status?: Exclude<SessionTemplateStatus, 'archived'>;
}

export class ListSessionTemplatesQueryDto {
  @IsOptional()
  @IsIn(SESSION_TYPES)
  sessionType?: SessionType;

  /** Defaults to `published`; `all` includes drafts and archived. */
  @IsOptional()
  @IsIn([...SESSION_TEMPLATE_STATUSES, 'all'])
  status?: SessionTemplateStatus | 'all';

  @IsOptional()
  @IsIn(['system', 'organization', 'private'])
  visibility?: SessionTemplateVisibility;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  pack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tag?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
