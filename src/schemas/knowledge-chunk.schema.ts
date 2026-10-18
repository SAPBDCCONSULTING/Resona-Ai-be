import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type KnowledgeChunkDocument = HydratedDocument<KnowledgeChunk>;

/**
 * One bounded slice of extracted text from a KnowledgeSource. Kept separate
 * from KnowledgeSource (which only ever holds metadata) so retrieval queries
 * never need to touch the larger/rarer-to-query source document, and so a
 * future embedding field can be added per-chunk without a schema redesign.
 */
@Schema({ timestamps: true, collection: 'knowledge_chunks' })
export class KnowledgeChunk {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  orgId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'KnowledgeSource', required: true, index: true })
  sourceId!: Types.ObjectId;

  /**
   * Which version of the source this chunk belongs to — mirrors
   * KnowledgeSource.version so a reprocess can write new chunks without
   * ambiguity about which generation a given chunk came from, and old
   * generations can be cleaned up precisely.
   */
  @Prop({ required: true, min: 1 })
  sourceVersion!: number;

  @Prop({ required: true, min: 0 })
  chunkIndex!: number;

  @Prop({ required: true, trim: true })
  text!: string;

  @Prop({ required: true, min: 0 })
  charCount!: number;

  /**
   * Nearest preceding Markdown heading, when the source actually had one.
   * Never fabricated — null for plain .txt sources or chunks with no
   * preceding heading, by construction of the chunker, not by omission.
   */
  @Prop({ type: String, default: null })
  section!: string | null;

  /**
   * Plain .txt/.md have no real pagination — this stays null for this MVP's
   * supported formats rather than inventing a page number. Reserved for
   * formats (PDF etc.) that genuinely have pages, not implemented yet.
   */
  @Prop({ type: Number, default: null })
  page!: number | null;

  /**
   * Null until (and unless) an embedding provider is configured and
   * generation succeeds — never a fabricated or zero-filled vector.
   * Retrieval's existing re-verification (parent source still eligible AND
   * sourceVersion still current) applies to this field exactly as it does
   * to `text`, so a reprocess/supersede that leaves old-version chunks
   * behind can never surface a stale embedding either — there is no
   * separate embedding store to go stale independently of the chunk.
   */
  @Prop({ type: [Number], default: null })
  embedding!: number[] | null;

  @Prop({ type: String, default: null })
  embeddingModel!: string | null;

  @Prop({ type: Date, default: null })
  embeddedAt!: Date | null;
}

export const KnowledgeChunkSchema = SchemaFactory.createForClass(KnowledgeChunk);

// orgId-first, matching every other schema's indexing convention in this codebase.
KnowledgeChunkSchema.index(
  { orgId: 1, sourceId: 1, sourceVersion: 1, chunkIndex: 1 },
  { unique: true },
);

/**
 * MongoDB restriction: a collection may have at most ONE text index, but that
 * text index CAN be a compound index with ordinary equality keys listed before
 * the text key — exactly the supported pattern for scoping full-text search to
 * a tenant. Queries use { orgId: X, $text: { $search: ... } }: orgId matches
 * as a normal equality prefix, text as the $text search. This coexists fine
 * with the unique index above (that restriction is only "one text index per
 * collection", not "no other indexes alongside it").
 */
KnowledgeChunkSchema.index({ orgId: 1, text: 'text' });
