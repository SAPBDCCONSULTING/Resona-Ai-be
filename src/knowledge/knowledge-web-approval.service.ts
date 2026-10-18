import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { URL } from 'url';
import type {
  KnowledgeAuditAction,
  KnowledgeWebApproval as KnowledgeWebApprovalDto,
} from '@pulsefeedback/shared';
import {
  KnowledgeAuditEvent,
  KnowledgeAuditEventDocument,
} from '../schemas/knowledge-audit-event.schema';
import {
  KnowledgeWebApproval,
  KnowledgeWebApprovalDocument,
} from '../schemas/knowledge-web-approval.schema';
import { CreateWebApprovalDto } from './dto/web-approval.dto';
import { isForbiddenAddress, parseAndValidateUrlShape, WebFetchError } from './web-ssrf-guard.util';

/**
 * Server-controlled approval records for web-page ingestion. Only this
 * service creates/revokes entries (gated by kb:web_manage at the
 * controller) and only this service decides whether a URL is approved
 * (isUrlApproved) — the fetch orchestration in web-fetch.util.ts never
 * decides approval itself, it only calls back into this check.
 */
@Injectable()
export class KnowledgeWebApprovalService {
  private readonly logger = new Logger(KnowledgeWebApprovalService.name);

  constructor(
    @InjectModel(KnowledgeWebApproval.name)
    private readonly approvals: Model<KnowledgeWebApprovalDocument>,
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

  /**
   * 'domain' normalizes to scheme+host[:port] only — path/query are
   * dropped, so a domain approval can never silently imply anything about
   * a different scheme or port than exactly what was approved. 'exact_url'
   * keeps the full normalized URL, including path+query.
   */
  private normalizeValue(type: 'exact_url' | 'domain', url: URL): string {
    return type === 'domain' ? `${url.protocol}//${url.host}` : url.toString();
  }

  private isDuplicateKeyError(err: unknown): boolean {
    return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
  }

  async create(orgId: string, userId: string, dto: CreateWebApprovalDto): Promise<KnowledgeWebApprovalDto> {
    let url: URL;
    try {
      url = parseAndValidateUrlShape(dto.value);
    } catch (err) {
      throw new BadRequestException(err instanceof WebFetchError ? err.message : 'Invalid URL.');
    }
    // Reject an obviously-unsafe literal IP at approval time too — not
    // just at fetch time. A hostname that is a DNS name (not a literal
    // IP) cannot be checked this way without a network lookup, which this
    // method deliberately does not perform; see the service-level report
    // for why connection-time enforcement, not approval-time DNS
    // resolution, is this feature's real SSRF boundary.
    if (/^[0-9a-fA-F.:]+$/.test(url.hostname) && isForbiddenAddress(url.hostname)) {
      throw new BadRequestException('This URL resolves to a non-public address and cannot be approved.');
    }

    const orgObjectId = new Types.ObjectId(orgId);
    const value = this.normalizeValue(dto.type, url);

    let doc: KnowledgeWebApprovalDocument;
    try {
      doc = await this.approvals.create({
        orgId: orgObjectId,
        type: dto.type,
        value,
        status: 'active',
        createdBy: new Types.ObjectId(userId),
      });
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        throw new BadRequestException('This URL/domain is already approved for this organization.');
      }
      throw err;
    }

    await this.recordAudit(orgObjectId, new Types.ObjectId(userId), 'web_approval_created', 'Web approval created.', {
      type: dto.type,
    });

    return this.toDto(doc.toObject() as unknown as Record<string, unknown>);
  }

  async list(orgId: string): Promise<KnowledgeWebApprovalDto[]> {
    const docs = await this.approvals
      .find({ orgId: new Types.ObjectId(orgId) })
      .sort({ createdAt: -1 })
      .lean();
    return docs.map((d) => this.toDto(d));
  }

  async revoke(orgId: string, userId: string, id: string): Promise<KnowledgeWebApprovalDto> {
    const orgObjectId = new Types.ObjectId(orgId);
    const doc = await this.approvals.findOne({ _id: id, orgId: orgObjectId });
    if (!doc) throw new NotFoundException('Approval entry not found.');
    if (doc.status === 'revoked') {
      throw new BadRequestException('This entry is already revoked.');
    }
    doc.status = 'revoked';
    doc.revokedBy = new Types.ObjectId(userId);
    doc.revokedAt = new Date();
    await doc.save();

    await this.recordAudit(orgObjectId, new Types.ObjectId(userId), 'web_approval_revoked', 'Web approval revoked.');

    return this.toDto(doc.toObject() as unknown as Record<string, unknown>);
  }

  /**
   * The actual authorization check used at fetch time for both the start
   * URL and every redirect hop — never bypassed, never cached across
   * calls. Matches an active 'exact_url' entry (full URL, including
   * path+query) OR an active 'domain' entry (scheme+host+port only).
   */
  async isUrlApproved(orgId: string, candidate: URL): Promise<boolean> {
    const orgObjectId = new Types.ObjectId(orgId);
    const exactValue = candidate.toString();
    const domainValue = `${candidate.protocol}//${candidate.host}`;
    const match = await this.approvals
      .findOne({
        orgId: orgObjectId,
        status: 'active',
        $or: [
          { type: 'exact_url', value: exactValue },
          { type: 'domain', value: domainValue },
        ],
      })
      .lean();
    return !!match;
  }

  private toDto(d: Record<string, unknown>): KnowledgeWebApprovalDto {
    const createdAt =
      d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date().toISOString();
    return {
      id: String(d._id),
      orgId: String(d.orgId),
      type: d.type as KnowledgeWebApprovalDto['type'],
      value: String(d.value),
      status: d.status as KnowledgeWebApprovalDto['status'],
      createdBy: String(d.createdBy),
      createdAt,
      revokedBy: d.revokedBy ? String(d.revokedBy) : null,
      revokedAt: d.revokedAt instanceof Date ? d.revokedAt.toISOString() : null,
    };
  }
}
