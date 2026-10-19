import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { KNOWLEDGE_COLLECTIONS, type KnowledgeCollection } from '@pulsefeedback/shared';

export class CreateKnowledgeCollectionDto {
  @IsIn(KNOWLEDGE_COLLECTIONS)
  key!: KnowledgeCollection;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateKnowledgeCollectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}
