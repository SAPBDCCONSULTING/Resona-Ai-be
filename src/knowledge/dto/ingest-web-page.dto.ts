import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsMongoId,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { KNOWLEDGE_COLLECTIONS, type KbSurface, type KnowledgeCollection } from '@pulsefeedback/shared';
import { KB_SURFACE_VALUES } from './upload-source.dto';

export class IngestWebPageDto {
  /** Must match an active approval entry for this org — never fetched just because it's a well-formed URL. */
  @IsUrl({ protocols: ['https'], require_protocol: true })
  url!: string;

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

  @IsOptional()
  @IsMongoId()
  ownerUserId?: string;

  @IsOptional()
  @IsIn(KNOWLEDGE_COLLECTIONS)
  category?: KnowledgeCollection;

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
