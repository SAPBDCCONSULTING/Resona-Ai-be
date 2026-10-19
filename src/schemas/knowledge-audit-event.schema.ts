import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { KnowledgeAuditAction } from '@pulsefeedback/shared';

export type KnowledgeAuditEventDocument = HydratedDocument<KnowledgeAuditEvent>;

export const KNOWLEDGE_AUDIT_ACTIONS: KnowledgeAuditAction[] = [
  'uploaded',
  'duplicate_upload',
  'processing_failed',
  'metadata_updated',
  'published',
  'archived',
  'superseded',
  'reprocessed',
];

/**
 * Governance audit trail for KnowledgeSource lifecycle operations — the
 * first audit-log concept introduced in this codebase (none previously
 * existed to follow a convention from), so it's kept deliberately minimal
 * and mirrors every other schema's own conventions (timestamps, orgId-first
 * compound index) rather than any new framework.
 *
 * `metadata` is a shallow, server-constructed record of safe primitive
 * values only (e.g. {fromStatus, toStatus} or {fields: ['title']}) — never
 * raw document content, user free text, tokens, or provider error bodies.
 * Every write path in KnowledgeService that populates it is responsible
 * for that guarantee; this schema cannot enforce it structurally beyond
 * the primitive-only type.
 */
@Schema({ timestamps: true, collection: 'knowledge_audit_events' })
export class KnowledgeAuditEvent {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  orgId!: Types.ObjectId;

  /** Null for an approval-management event or a blocked ingest attempt — no KnowledgeSource exists yet for those. */
  @Prop({ type: Types.ObjectId, ref: 'KnowledgeSource', default: null, index: true })
  sourceId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actorUserId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: KNOWLEDGE_AUDIT_ACTIONS })
  action!: KnowledgeAuditAction;

  @Prop({ required: true, trim: true })
  outcome!: string;

  @Prop({ type: Object, default: null })
  metadata!: Record<string, string | number | boolean | null> | null;
}

export const KnowledgeAuditEventSchema = SchemaFactory.createForClass(KnowledgeAuditEvent);
KnowledgeAuditEventSchema.index({ orgId: 1, sourceId: 1, createdAt: -1 });
