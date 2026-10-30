import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  KnowledgeAuditAction,
  KnowledgeFeedback as KnowledgeFeedbackDto,
} from '@pulsefeedback/shared';
import {
  KnowledgeAuditEvent,
  KnowledgeAuditEventDocument,
} from '../schemas/knowledge-audit-event.schema';
import {
  KnowledgeFeedback,
  KnowledgeFeedbackDocument,
} from '../schemas/knowledge-feedback.schema';
import { KnowledgeSource, KnowledgeSourceDocument } from '../schemas/knowledge-source.schema';
import { ResolveKnowledgeFeedbackDto, SubmitKnowledgeFeedbackDto } from './dto/knowledge-feedback.dto';

/**
 * Privacy-conscious by construction — see the schema doc. Owner routing
 * never fabricates a route: `routed` is only true when the referenced
 * source actually has an `ownerUserId` configured at submission time;
 * otherwise the item has no owner and is visible only through the shared
 * fallback queue (anyone with kb:feedback_manage).
 */
@Injectable()
export class KnowledgeFeedbackService {
  private readonly logger = new Logger(KnowledgeFeedbackService.name);

  constructor(
    @InjectModel(KnowledgeFeedback.name)
    private readonly feedback: Model<KnowledgeFeedbackDocument>,
    @InjectModel(KnowledgeSource.name)
    private readonly sources: Model<KnowledgeSourceDocument>,
    @InjectModel(KnowledgeAuditEvent.name)
    private readonly auditEvents: Model<KnowledgeAuditEventDocument>,
  ) {}

  private async recordAudit(
    orgId: Types.ObjectId,
    sourceId: Types.ObjectId | null,
    actorUserId: Types.ObjectId,
    action: KnowledgeAuditAction,
    outcome: string,
    metadata: Record<string, string | number | boolean | null> | null = null,
  ): Promise<void> {
    try {
      await this.auditEvents.create({ orgId, sourceId, actorUserId, action, outcome, metadata });
    } catch {
      this.logger.warn(`Failed to record knowledge audit event "${action}".`);
    }
  }

  async submit(
    orgId: string,
    userId: string,
    dto: SubmitKnowledgeFeedbackDto,
  ): Promise<KnowledgeFeedbackDto> {
    if (!dto.rating && !dto.issueType) {
      throw new BadRequestException('Provide at least a rating or an issue type.');
    }
    const orgObjectId = new Types.ObjectId(orgId);
    const actorId = new Types.ObjectId(userId);

    let citationSourceId: Types.ObjectId | null = null;
    let citationSourceVersion: number | null = null;
    let ownerUserId: Types.ObjectId | null = null;
    let routed = false;

    if (dto.citationSourceId) {
      // Never trust a cross-org reference — the source must belong to
      // this exact org or the citation is rejected outright.
      const source = await this.sources
        .findOne({ _id: dto.citationSourceId, orgId: orgObjectId })
        .lean();
      if (!source) {
        throw new BadRequestException('The referenced source does not exist in this organization.');
      }
      citationSourceId = source._id as Types.ObjectId;
      citationSourceVersion = dto.citationSourceVersion ?? (source.version as number);
      if (source.ownerUserId) {
        ownerUserId = source.ownerUserId as Types.ObjectId;
        routed = true;
      }
    }
    const citationChunkId = dto.citationChunkId ? new Types.ObjectId(dto.citationChunkId) : null;

    // Idempotent duplicate handling: one row per (org, actor, answerRef) —
    // a second submission for the same answer updates the existing row
    // rather than creating a duplicate.
    if (dto.answerRef) {
      const existing = await this.feedback.findOne({
        orgId: orgObjectId,
        actorUserId: actorId,
        answerRef: dto.answerRef,
      });
      if (existing) {
        existing.rating = dto.rating ?? existing.rating;
        existing.issueType = dto.issueType ?? existing.issueType;
        existing.explanation = dto.explanation?.trim() || existing.explanation;
        existing.surface = dto.surface ?? existing.surface;
        if (citationSourceId) {
          existing.citationSourceId = citationSourceId;
          existing.citationSourceVersion = citationSourceVersion;
          existing.ownerUserId = ownerUserId;
          existing.routed = routed;
        }
        if (citationChunkId) existing.citationChunkId = citationChunkId;
        await existing.save();
        return this.toDto(existing.toObject() as unknown as Record<string, unknown>);
      }
    }

    const doc = await this.feedback.create({
      orgId: orgObjectId,
      actorUserId: actorId,
      rating: dto.rating ?? null,
      issueType: dto.issueType ?? null,
      explanation: dto.explanation?.trim() || null,
      surface: dto.surface ?? null,
      answerRef: dto.answerRef?.trim() || null,
      citationSourceId,
      citationSourceVersion,
      citationChunkId,
      status: 'open',
      ownerUserId,
      routed,
    });

    await this.recordAudit(
      orgObjectId,
      citationSourceId,
      actorId,
      'feedback_submitted',
      routed
        ? 'Feedback submitted and routed to the configured owner.'
        : 'Feedback submitted; no owner configured, added to the fallback queue.',
      { routed, hasCitation: Boolean(citationSourceId) },
    );

    return this.toDto(doc.toObject() as unknown as Record<string, unknown>);
  }

  /**
   * canManage=true sees every feedback item for the org (kb:feedback_manage).
   * canManage=false sees only items explicitly routed to this exact user —
   * never items with no owner (the fallback queue is manage-only), and
   * never another user's assigned items.
   */
  async list(
    orgId: string,
    userId: string,
    canManage: boolean,
    filters: { status?: string } = {},
  ): Promise<KnowledgeFeedbackDto[]> {
    const orgObjectId = new Types.ObjectId(orgId);
    const query: Record<string, unknown> = { orgId: orgObjectId };
    if (!canManage) {
      query.ownerUserId = new Types.ObjectId(userId);
    }
    if (filters.status) query.status = filters.status;
    const docs = await this.feedback.find(query).sort({ createdAt: -1 }).lean();
    return docs.map((d) => this.toDto(d));
  }

  async resolve(
    orgId: string,
    userId: string,
    canManage: boolean,
    id: string,
    dto: ResolveKnowledgeFeedbackDto,
  ): Promise<KnowledgeFeedbackDto> {
    const orgObjectId = new Types.ObjectId(orgId);
    const doc = await this.feedback.findOne({ _id: id, orgId: orgObjectId });
    if (!doc) throw new NotFoundException('Feedback not found.');

    const isAssignedOwner = Boolean(doc.ownerUserId) && String(doc.ownerUserId) === userId;
    if (!canManage && !isAssignedOwner) {
      throw new ForbiddenException('You are not authorized to resolve this feedback item.');
    }

    const fromStatus = doc.status;
    doc.status = dto.status;
    doc.resolutionNote = dto.resolutionNote?.trim() || null;
    if (dto.status === 'resolved' || dto.status === 'dismissed') {
      doc.resolvedBy = new Types.ObjectId(userId);
      doc.resolvedAt = new Date();
    } else {
      doc.resolvedBy = null;
      doc.resolvedAt = null;
    }
    await doc.save();

    await this.recordAudit(
      orgObjectId,
      doc.citationSourceId,
      new Types.ObjectId(userId),
      'feedback_status_changed',
      `Feedback status changed from "${fromStatus}" to "${dto.status}".`,
      { fromStatus, toStatus: dto.status },
    );

    return this.toDto(doc.toObject() as unknown as Record<string, unknown>);
  }

  private toDto(d: Record<string, unknown>): KnowledgeFeedbackDto {
    const createdAt =
      d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date().toISOString();
    const updatedAt = d.updatedAt instanceof Date ? d.updatedAt.toISOString() : createdAt;
    return {
      id: String(d._id),
      orgId: String(d.orgId),
      actorUserId: String(d.actorUserId),
      rating: (d.rating as KnowledgeFeedbackDto['rating']) ?? null,
      issueType: (d.issueType as KnowledgeFeedbackDto['issueType']) ?? null,
      explanation: (d.explanation as string | null) ?? null,
      surface: (d.surface as KnowledgeFeedbackDto['surface']) ?? null,
      answerRef: (d.answerRef as string | null) ?? null,
      citationSourceId: d.citationSourceId ? String(d.citationSourceId) : null,
      citationSourceVersion: (d.citationSourceVersion as number | null) ?? null,
      citationChunkId: d.citationChunkId ? String(d.citationChunkId) : null,
      status: d.status as KnowledgeFeedbackDto['status'],
      ownerUserId: d.ownerUserId ? String(d.ownerUserId) : null,
      routed: Boolean(d.routed),
      resolvedBy: d.resolvedBy ? String(d.resolvedBy) : null,
      resolvedAt: d.resolvedAt instanceof Date ? d.resolvedAt.toISOString() : null,
      resolutionNote: (d.resolutionNote as string | null) ?? null,
      createdAt,
      updatedAt,
    };
  }
}
