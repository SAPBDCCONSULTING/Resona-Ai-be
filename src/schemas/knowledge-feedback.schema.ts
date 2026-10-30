import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type {
  KbSurface,
  KnowledgeFeedbackIssueType,
  KnowledgeFeedbackRating,
} from '@pulsefeedback/shared';

export type KnowledgeFeedbackDocument = HydratedDocument<KnowledgeFeedback>;

export const KNOWLEDGE_FEEDBACK_RATINGS = ['helpful', 'not_helpful'] as const;
export const KNOWLEDGE_FEEDBACK_ISSUE_TYPES = ['incorrect', 'outdated', 'conflicting', 'missing'] as const;
export const KNOWLEDGE_FEEDBACK_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const;
export type KnowledgeFeedbackStatus = (typeof KNOWLEDGE_FEEDBACK_STATUSES)[number];

/**
 * Privacy-conscious by construction: there is deliberately no field here
 * for the full prompt, the full AI answer, or document content — only
 * structural references (surface, citation source/chunk/version) plus
 * whatever short, bounded explanation the person themselves typed.
 */
@Schema({ timestamps: true, collection: 'knowledge_feedback' })
export class KnowledgeFeedback {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  orgId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  actorUserId!: Types.ObjectId;

  @Prop({ type: String, enum: KNOWLEDGE_FEEDBACK_RATINGS, default: null })
  rating!: KnowledgeFeedbackRating | null;

  @Prop({ type: String, enum: KNOWLEDGE_FEEDBACK_ISSUE_TYPES, default: null })
  issueType!: KnowledgeFeedbackIssueType | null;

  @Prop({ type: String, default: null, trim: true, maxlength: 1000 })
  explanation!: string | null;

  @Prop({ type: String, default: null })
  surface!: KbSurface | null;

  /** Opaque, client-supplied — never trusted for authorization, only for duplicate-submission detection and display correlation. */
  @Prop({ type: String, default: null, trim: true, maxlength: 200 })
  answerRef!: string | null;

  @Prop({ type: Types.ObjectId, ref: 'KnowledgeSource', default: null, index: true })
  citationSourceId!: Types.ObjectId | null;

  @Prop({ type: Number, default: null })
  citationSourceVersion!: number | null;

  @Prop({ type: Types.ObjectId, ref: 'KnowledgeChunk', default: null })
  citationChunkId!: Types.ObjectId | null;

  @Prop({ type: String, required: true, enum: KNOWLEDGE_FEEDBACK_STATUSES, default: 'open', index: true })
  status!: KnowledgeFeedbackStatus;

  /** Snapshot of the source's configured owner at submission time — never a live reference; routed below records whether this was ever actually set. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  ownerUserId!: Types.ObjectId | null;

  /** False means no owner was configured when this was submitted — it went to the shared fallback queue, never a fabricated route. */
  @Prop({ required: true, default: false })
  routed!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  resolvedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  resolvedAt!: Date | null;

  @Prop({ type: String, default: null, trim: true, maxlength: 1000 })
  resolutionNote!: string | null;
}

export const KnowledgeFeedbackSchema = SchemaFactory.createForClass(KnowledgeFeedback);

// orgId-first, matching every other schema's indexing convention.
KnowledgeFeedbackSchema.index({ orgId: 1, status: 1, createdAt: -1 });
KnowledgeFeedbackSchema.index({ orgId: 1, ownerUserId: 1, status: 1 });
// Supports idempotent duplicate-submission handling: one row per (org, actor, answerRef) when answerRef is given.
KnowledgeFeedbackSchema.index(
  { orgId: 1, actorUserId: 1, answerRef: 1 },
  { unique: true, partialFilterExpression: { answerRef: { $type: 'string' } } },
);
