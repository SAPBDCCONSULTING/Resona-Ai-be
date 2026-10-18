import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  KNOWLEDGE_COLLECTIONS,
  type KbSurface,
  type KnowledgeCollection,
  type MalwareScanStatus,
} from '@pulsefeedback/shared';

export type KnowledgeSourceDocument = HydratedDocument<KnowledgeSource>;

/** Re-exported so existing `import { type KnowledgeCollection } from './knowledge-source.schema'` call sites keep working unchanged. */
export type { KnowledgeCollection };
export { KNOWLEDGE_COLLECTIONS };

/**
 * 'superseded' is distinct from 'archived': superseded means a specific
 * newer source now replaces this one (supersededBySourceId is set); archived
 * means it was manually retired with no designated replacement. Both are
 * terminal and excluded from AI retrieval the same way (only 'published'
 * sources are ever eligible).
 *
 * 'deleted' is a further, one-way step past archived/superseded/failed —
 * see the shared KnowledgeSourceStatus doc comment for the full retention
 * rationale (tombstone row, chunks/embeddings/file purged, no path back).
 */
export type KnowledgeSourceStatus =
  | 'processing'
  | 'pending_review'
  | 'published'
  | 'superseded'
  | 'archived'
  | 'failed'
  | 'deleted';

export const KNOWLEDGE_SOURCE_STATUSES: KnowledgeSourceStatus[] = [
  'processing',
  'pending_review',
  'published',
  'superseded',
  'archived',
  'failed',
  'deleted',
];

/**
 * Metadata for one uploaded document. The raw bytes live in GridFS
 * (referenced by gridFsFileId); extracted/chunked text lives in separate
 * KnowledgeChunk documents. Never store document content on this schema —
 * keeps "what is this file" cleanly separate from "what does it say"
 * (per the required separation of source storage, chunks, and curated
 * static articles).
 */
@Schema({ timestamps: true, collection: 'knowledge_sources' })
export class KnowledgeSource {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  orgId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ type: String, default: null, trim: true })
  description!: string | null;

  @Prop({
    required: true,
    enum: KNOWLEDGE_SOURCE_STATUSES,
    default: 'processing',
    index: true,
  })
  status!: KnowledgeSourceStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  uploadedBy!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  originalFilename!: string;

  /** Validated against an allowlist server-side — never trusted from the client alone. */
  @Prop({ required: true })
  mimeType!: string;

  @Prop({ required: true, min: 0 })
  sizeBytes!: number;

  /** sha256 of the raw uploaded bytes — duplicate detection, scoped per org. */
  @Prop({ required: true })
  contentHash!: string;

  /** Reference into GridFS's own fs.files collection for this source's raw bytes. */
  @Prop({ type: Types.ObjectId, required: true })
  gridFsFileId!: Types.ObjectId;

  /** Which AI surfaces this source's chunks are eligible for once published. */
  @Prop({ type: [String], default: [] })
  surfaces!: KbSurface[];

  /**
   * Safe, non-sensitive failure description only — never the raw extraction
   * error/stack trace, and never a snippet of document content.
   */
  @Prop({ type: String, default: null })
  processingError!: string | null;

  /** Bumped on re-upload of the same (orgId, contentHash) pair — stale/conflict handling. */
  @Prop({ required: true, default: 1, min: 1 })
  version!: number;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  publishedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  archivedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  archivedAt!: Date | null;

  /** Person responsible for this document's accuracy/upkeep — see schema-level note in shared/src/index.ts on why there is no team/department dimension. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  ownerUserId!: Types.ObjectId | null;

  /** Named `category` on the schema (not `collection`) — `collection` is already a reserved @Schema() option name for the MongoDB collection itself. */
  @Prop({ type: String, enum: KNOWLEDGE_COLLECTIONS, default: null })
  category!: KnowledgeCollection | null;

  /**
   * Role ids (this org's own Role documents) allowed to have this source
   * ground AI answers, on top of the existing org+published+surface rules.
   * Empty = unrestricted — the default, and the only behavior that existed
   * before this field, so existing/untouched sources are unaffected.
   */
  @Prop({ type: [Types.ObjectId], ref: 'Role', default: [] })
  accessRoleIds!: Types.ObjectId[];

  /** Null = effective immediately. */
  @Prop({ type: Date, default: null })
  effectiveAt!: Date | null;

  /** Null = never expires. */
  @Prop({ type: Date, default: null })
  expiresAt!: Date | null;

  /** Informational reminder date only — not enforced at retrieval. */
  @Prop({ type: Date, default: null })
  reviewDueAt!: Date | null;

  /** Set when this source was uploaded as the designated replacement for another. */
  @Prop({ type: Types.ObjectId, ref: 'KnowledgeSource', default: null })
  supersedesSourceId!: Types.ObjectId | null;

  /** Set when another source has been marked as this one's replacement. */
  @Prop({ type: Types.ObjectId, ref: 'KnowledgeSource', default: null })
  supersededBySourceId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  supersededBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  supersededAt!: Date | null;

  /** Set only when status reaches 'deleted' — see KnowledgeSourceStatus doc. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  /** See shared MalwareScanStatus doc — this environment has no real scanner, so this is always 'not_scanned' today. Never set to 'clean' without a real scan having run. */
  @Prop({ type: String, enum: ['not_scanned', 'clean', 'infected', 'scan_failed'], default: 'not_scanned' })
  malwareScanStatus!: MalwareScanStatus;
}

export const KnowledgeSourceSchema = SchemaFactory.createForClass(KnowledgeSource);

// orgId-first, matching every other schema's indexing convention in this codebase.
KnowledgeSourceSchema.index({ orgId: 1, contentHash: 1 }, { unique: true });
KnowledgeSourceSchema.index({ orgId: 1, status: 1, updatedAt: -1 });
KnowledgeSourceSchema.index({ orgId: 1, surfaces: 1 });
KnowledgeSourceSchema.index({ orgId: 1, category: 1 });
