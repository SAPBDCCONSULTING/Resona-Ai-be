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
import { KB_SURFACE_VALUES } from './upload-source.dto';

export class UpdateKnowledgeSourceDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @IsIn(KB_SURFACE_VALUES, { each: true })
  surfaces?: KbSurface[];

  /** null clears the owner. Validated server-side to actually belong to this org. */
  @IsOptional()
  @IsMongoId()
  ownerUserId?: string | null;

  /** null clears the category. */
  @IsOptional()
  @IsIn(KNOWLEDGE_COLLECTIONS)
  category?: KnowledgeCollection | null;

  /** Validated server-side to be real Role documents belonging to this org. Empty array clears the restriction (unrestricted). */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsMongoId({ each: true })
  accessRoleIds?: string[];

  @IsOptional()
  @IsISO8601()
  effectiveAt?: string | null;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @IsISO8601()
  reviewDueAt?: string | null;
}
