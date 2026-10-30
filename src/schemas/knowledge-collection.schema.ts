import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { KNOWLEDGE_COLLECTIONS, type KnowledgeCollection } from '@pulsefeedback/shared';

export type KnowledgeCollectionDocument = HydratedDocument<KnowledgeCollectionEntity>;

export const KNOWLEDGE_COLLECTION_STATUSES = ['active', 'archived'] as const;
export type KnowledgeCollectionEntityStatus = (typeof KNOWLEDGE_COLLECTION_STATUSES)[number];

/**
 * The managed governance record for a collection — separate from
 * KnowledgeSource.category (an unchanged, simple per-source tag) and from
 * accessRoleIds/surfaces (access control and AI-surface routing are not
 * collection concerns, kept orthogonal on purpose).
 *
 * `key` is immutable once created: it is the stable value every
 * KnowledgeSource.category reference actually points at, and changing it
 * post-creation would silently orphan existing sources' category tags.
 * Only `name`/`description`/`status` are ever updated.
 */
@Schema({ timestamps: true, collection: 'knowledge_collections' })
export class KnowledgeCollectionEntity {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  orgId!: Types.ObjectId;

  @Prop({ type: String, required: true, enum: KNOWLEDGE_COLLECTIONS })
  key!: KnowledgeCollection;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: String, default: null, trim: true })
  description!: string | null;

  @Prop({ type: String, required: true, enum: KNOWLEDGE_COLLECTION_STATUSES, default: 'active', index: true })
  status!: KnowledgeCollectionEntityStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  archivedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  archivedAt!: Date | null;
}

export const KnowledgeCollectionSchema = SchemaFactory.createForClass(KnowledgeCollectionEntity);

// orgId-first, matching every other schema's indexing convention.
KnowledgeCollectionSchema.index({ orgId: 1, key: 1 }, { unique: true });
KnowledgeCollectionSchema.index({ orgId: 1, status: 1 });
