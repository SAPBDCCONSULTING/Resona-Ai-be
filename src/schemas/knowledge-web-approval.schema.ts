import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { WebApprovalType } from '@pulsefeedback/shared';

export type KnowledgeWebApprovalDocument = HydratedDocument<KnowledgeWebApproval>;

export const WEB_APPROVAL_TYPES: WebApprovalType[] = ['exact_url', 'domain'];
export const WEB_APPROVAL_STATUSES = ['active', 'revoked'] as const;
export type WebApprovalStatus = (typeof WEB_APPROVAL_STATUSES)[number];

/**
 * An admin-curated allowlist entry for approved web-page ingestion. Only
 * an authorized administrator (kb:web_manage) can create or revoke one —
 * the ingest action itself never accepts or fetches an arbitrary
 * caller-supplied URL, only one matching an active entry here.
 *
 * `value` always stores a full URL string (scheme+host+port, and for
 * 'exact_url' also the path+query). Matching semantics live in
 * KnowledgeWebApprovalService, not here — this schema only stores the
 * record.
 */
@Schema({ timestamps: true, collection: 'knowledge_web_approvals' })
export class KnowledgeWebApproval {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  orgId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: WEB_APPROVAL_TYPES })
  type!: WebApprovalType;

  @Prop({ required: true, trim: true })
  value!: string;

  @Prop({ type: String, required: true, enum: WEB_APPROVAL_STATUSES, default: 'active', index: true })
  status!: WebApprovalStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  revokedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;
}

export const KnowledgeWebApprovalSchema = SchemaFactory.createForClass(KnowledgeWebApproval);

// orgId-first, matching every other schema's indexing convention.
KnowledgeWebApprovalSchema.index({ orgId: 1, type: 1, value: 1 }, { unique: true });
KnowledgeWebApprovalSchema.index({ orgId: 1, status: 1 });
