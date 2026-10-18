import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  KNOWLEDGE_COLLECTION_LABELS,
  type KnowledgeAuditAction,
  type KnowledgeCollection,
  type KnowledgeCollectionRecord as KnowledgeCollectionDto,
} from '@pulsefeedback/shared';
import {
  KnowledgeAuditEvent,
  KnowledgeAuditEventDocument,
} from '../schemas/knowledge-audit-event.schema';
import {
  KnowledgeCollectionDocument,
  KnowledgeCollectionEntity,
} from '../schemas/knowledge-collection.schema';
import { KnowledgeSource, KnowledgeSourceDocument } from '../schemas/knowledge-source.schema';
import { CreateKnowledgeCollectionDto, UpdateKnowledgeCollectionDto } from './dto/knowledge-collection.dto';

/**
 * The governance layer on top of KnowledgeSource.category. A collection
 * record's `key` matches a category value 1:1 per org; archiving a
 * collection NEVER touches any KnowledgeSource that already has that
 * category tag — it only blocks *new* sources from being assigned to it
 * (enforced by assertCategoryAssignable, called from KnowledgeService).
 */
@Injectable()
export class KnowledgeCollectionService {
  private readonly logger = new Logger(KnowledgeCollectionService.name);

  constructor(
    @InjectModel(KnowledgeCollectionEntity.name)
    private readonly collections: Model<KnowledgeCollectionDocument>,
    @InjectModel(KnowledgeSource.name)
    private readonly sources: Model<KnowledgeSourceDocument>,
    @InjectModel(KnowledgeAuditEvent.name)
    private readonly auditEvents: Model<KnowledgeAuditEventDocument>,
  ) {}

  private async recordAudit(
    orgId: Types.ObjectId,
    actorUserId: Types.ObjectId,
    action: KnowledgeAuditAction,
    outcome: string,
    metadata: Record<string, string | number | boolean | null> | null = null,
  ): Promise<void> {
    try {
      await this.auditEvents.create({ orgId, sourceId: null, actorUserId, action, outcome, metadata });
    } catch {
      this.logger.warn(`Failed to record knowledge audit event "${action}".`);
    }
  }

  async create(
    orgId: string,
    userId: string,
    dto: CreateKnowledgeCollectionDto,
  ): Promise<KnowledgeCollectionDto> {
    const orgObjectId = new Types.ObjectId(orgId);
    let doc: KnowledgeCollectionDocument;
    try {
      doc = await this.collections.create({
        orgId: orgObjectId,
        key: dto.key,
        name: dto.name?.trim() || KNOWLEDGE_COLLECTION_LABELS[dto.key],
        description: dto.description?.trim() || null,
        status: 'active',
        createdBy: new Types.ObjectId(userId),
      });
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        throw new BadRequestException(`A collection for "${dto.key}" already exists for this organization.`);
      }
      throw err;
    }

    await this.recordAudit(orgObjectId, new Types.ObjectId(userId), 'collection_created', 'Collection created.', {
      key: dto.key,
    });

    return this.toDto(doc.toObject() as unknown as Record<string, unknown>, 0);
  }

  async list(orgId: string): Promise<KnowledgeCollectionDto[]> {
    const orgObjectId = new Types.ObjectId(orgId);
    const docs = await this.collections.find({ orgId: orgObjectId }).sort({ key: 1 }).lean();
    const counts = await this.sourceCountsByCategory(orgObjectId);
    return docs.map((d) => this.toDto(d, counts.get(d.key as string) ?? 0));
  }

  async getOne(orgId: string, id: string): Promise<KnowledgeCollectionDto> {
    const orgObjectId = new Types.ObjectId(orgId);
    const doc = await this.findOwnedOrThrow(orgObjectId, id);
    const counts = await this.sourceCountsByCategory(orgObjectId);
    return this.toDto(doc.toObject() as unknown as Record<string, unknown>, counts.get(doc.key) ?? 0);
  }

  async update(
    orgId: string,
    userId: string,
    id: string,
    dto: UpdateKnowledgeCollectionDto,
  ): Promise<KnowledgeCollectionDto> {
    const orgObjectId = new Types.ObjectId(orgId);
    const doc = await this.findOwnedOrThrow(orgObjectId, id);

    const changedFields: string[] = [];
    if (dto.name !== undefined) {
      doc.name = dto.name.trim() || doc.name;
      changedFields.push('name');
    }
    if (dto.description !== undefined) {
      doc.description = dto.description?.trim() || null;
      changedFields.push('description');
    }
    await doc.save();

    if (changedFields.length) {
      await this.recordAudit(
        orgObjectId,
        new Types.ObjectId(userId),
        'collection_updated',
        'Collection metadata updated.',
        { fields: changedFields.join(',') },
      );
    }

    const counts = await this.sourceCountsByCategory(orgObjectId);
    return this.toDto(doc.toObject() as unknown as Record<string, unknown>, counts.get(doc.key) ?? 0);
  }

  /**
   * Archiving the collection record never touches any KnowledgeSource —
   * existing sources keep their category tag exactly as-is. It only
   * prevents *new* sources from being assigned to this category going
   * forward (see assertCategoryAssignable).
   */
  async archive(orgId: string, userId: string, id: string): Promise<KnowledgeCollectionDto> {
    const orgObjectId = new Types.ObjectId(orgId);
    const doc = await this.findOwnedOrThrow(orgObjectId, id);
    if (doc.status === 'archived') {
      throw new BadRequestException('This collection is already archived.');
    }
    doc.status = 'archived';
    doc.archivedBy = new Types.ObjectId(userId);
    doc.archivedAt = new Date();
    await doc.save();

    const counts = await this.sourceCountsByCategory(orgObjectId);
    await this.recordAudit(
      orgObjectId,
      new Types.ObjectId(userId),
      'collection_archived',
      'Collection archived.',
      { key: doc.key, sourceCountAtArchival: counts.get(doc.key) ?? 0 },
    );

    return this.toDto(doc.toObject() as unknown as Record<string, unknown>, counts.get(doc.key) ?? 0);
  }

  /**
   * Called by KnowledgeService before creating/updating a source with a
   * given category. If no collection record exists yet for this (org,
   * key) pair, the org hasn't opted into collection governance for it —
   * allow the plain tag exactly as before (backward compatible, zero
   * behavior change for orgs that never created collection records).
   * If a record exists and is archived, reject — never silently drop or
   * ignore the requested category.
   */
  async assertCategoryAssignable(orgId: string, category: KnowledgeCollection): Promise<void> {
    const doc = await this.collections
      .findOne({ orgId: new Types.ObjectId(orgId), key: category })
      .lean();
    if (doc && doc.status === 'archived') {
      throw new BadRequestException(
        `The "${KNOWLEDGE_COLLECTION_LABELS[category]}" collection is archived and cannot accept new sources.`,
      );
    }
  }

  private async sourceCountsByCategory(orgId: Types.ObjectId): Promise<Map<string, number>> {
    const rows = await this.sources.aggregate<{ _id: string; count: number }>([
      { $match: { orgId, category: { $ne: null } } },
      { $group: { _id: '$category', count: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [r._id, r.count]));
  }

  private async findOwnedOrThrow(orgId: Types.ObjectId, id: string): Promise<KnowledgeCollectionDocument> {
    const doc = await this.collections.findOne({ _id: id, orgId });
    if (!doc) throw new NotFoundException('Collection not found.');
    return doc;
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
  }

  private toDto(d: Record<string, unknown>, sourceCount: number): KnowledgeCollectionDto {
    const createdAt =
      d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date().toISOString();
    const updatedAt = d.updatedAt instanceof Date ? d.updatedAt.toISOString() : createdAt;
    return {
      id: String(d._id),
      orgId: String(d.orgId),
      key: d.key as KnowledgeCollectionDto['key'],
      name: String(d.name),
      description: (d.description as string | null) ?? null,
      status: d.status as KnowledgeCollectionDto['status'],
      sourceCount,
      createdBy: String(d.createdBy),
      archivedBy: d.archivedBy ? String(d.archivedBy) : null,
      archivedAt: d.archivedAt instanceof Date ? d.archivedAt.toISOString() : null,
      createdAt,
      updatedAt,
    };
  }
}
