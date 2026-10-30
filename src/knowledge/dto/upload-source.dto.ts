import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { KNOWLEDGE_COLLECTIONS, type KbSurface, type KnowledgeCollection } from '@pulsefeedback/shared';

/** Keep in sync with KbSurface's literal members — class-validator needs a runtime list. */
export const KB_SURFACE_VALUES: KbSurface[] = [
  'describe',
  'assistant',
  'employee_discussion',
  'topics',
];

export class UploadKnowledgeSourceDto {
  /** Defaults to the original filename when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsIn(KB_SURFACE_VALUES, { each: true })
  surfaces?: KbSurface[];

  /** Validated server-side to actually belong to this org — never trusted as-is. */
  @IsOptional()
  @IsMongoId()
  ownerUserId?: string;

  @IsOptional()
  @IsIn(KNOWLEDGE_COLLECTIONS)
  category?: KnowledgeCollection;

  /** Validated server-side to be real Role documents belonging to this org — never trusted as-is. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsMongoId({ each: true })
  accessRoleIds?: string[];

  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  @IsOptional()
  @IsISO8601()
  reviewDueAt?: string;
}
