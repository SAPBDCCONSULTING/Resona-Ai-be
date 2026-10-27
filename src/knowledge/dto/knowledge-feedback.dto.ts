import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import type { KbSurface, KnowledgeFeedbackIssueType, KnowledgeFeedbackRating } from '@pulsefeedback/shared';
import { KB_SURFACE_VALUES } from './upload-source.dto';
import {
  KNOWLEDGE_FEEDBACK_ISSUE_TYPES,
  KNOWLEDGE_FEEDBACK_RATINGS,
  KNOWLEDGE_FEEDBACK_STATUSES,
} from '../../schemas/knowledge-feedback.schema';

export class SubmitKnowledgeFeedbackDto {
  @IsOptional()
  @IsIn(KNOWLEDGE_FEEDBACK_RATINGS)
  rating?: KnowledgeFeedbackRating;

  @IsOptional()
  @IsIn(KNOWLEDGE_FEEDBACK_ISSUE_TYPES)
  issueType?: KnowledgeFeedbackIssueType;

  /** User-authored only — never the AI's own answer text. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  explanation?: string;

  @IsOptional()
  @IsIn(KB_SURFACE_VALUES)
  surface?: KbSurface;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  answerRef?: string;

  @IsOptional()
  @IsMongoId()
  citationSourceId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  citationSourceVersion?: number;

  @IsOptional()
  @IsMongoId()
  citationChunkId?: string;
}

export class ResolveKnowledgeFeedbackDto {
  @IsIn(KNOWLEDGE_FEEDBACK_STATUSES)
  status!: 'open' | 'reviewing' | 'resolved' | 'dismissed';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resolutionNote?: string;
}
