import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { GridFSBucket, type Db } from 'mongodb';
import { createHash, randomUUID } from 'crypto';
import { URL } from 'url';
import type {
  KbSurface,
  KnowledgeAuditAction,
  KnowledgeAuditEvent as KnowledgeAuditEventDto,
  KnowledgeChunk as KnowledgeChunkDto,
  KnowledgeSource as KnowledgeSourceDto,
} from '@pulsefeedback/shared';
import {
  KnowledgeAuditEvent,
  KnowledgeAuditEventDocument,
} from '../schemas/knowledge-audit-event.schema';
import {
  KnowledgeChunk,
  KnowledgeChunkDocument,
} from '../schemas/knowledge-chunk.schema';
import {
  KnowledgeSource,
  KnowledgeSourceDocument,
} from '../schemas/knowledge-source.schema';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { DeleteKnowledgeSourceDto } from './dto/delete-source.dto';
import { SupersedeKnowledgeSourceDto } from './dto/supersede-source.dto';
import { UpdateKnowledgeSourceDto } from './dto/update-source.dto';
import { UploadKnowledgeSourceDto } from './dto/upload-source.dto';
import {
  DEFAULT_DOCX_EXTRACTION_LIMITS,
  DEFAULT_PDF_EXTRACTION_LIMITS,
  DOCX_MIME_TYPE,
  DocumentExtractionError,
  PDF_MIME_TYPE,
  extractDocxChunks,
  extractPdfChunks,
  looksLikeDocx,
  looksLikePdf,
} from './knowledge-document-extraction.util';
import { IngestWebPageDto } from './dto/ingest-web-page.dto';
import { KnowledgeWebApprovalService } from './knowledge-web-approval.service';
import { KnowledgeCollectionService } from './knowledge-collection.service';
import { extractWebPageChunks, MAX_WEB_EXTRACTED_CHARS_DEFAULT } from './knowledge-web-extraction.util';
import { DEFAULT_WEB_FETCH_LIMITS, fetchApprovedWebPage } from './web-fetch.util';
import { WebFetchError } from './web-ssrf-guard.util';
import { chunkText, looksLikeBinary, type ExtractedChunk } from './knowledge-text.util';
import { MALWARE_SCAN_PROVIDER, type MalwareScanProvider } from './malware-scan-provider';
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from '../ai/embedding/embedding-provider';

const WEB_PAGE_MIME_TYPE = 'text/html';
const ALLOWED_MIME_TYPES = ['text/plain', 'text/markdown', PDF_MIME_TYPE, DOCX_MIME_TYPE];
const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024; // 2MB

export type UploadResult = { source: KnowledgeSourceDto; duplicate: boolean };

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    @InjectModel(KnowledgeSource.name)
    private readonly sources: Model<KnowledgeSourceDocument>,
    @InjectModel(KnowledgeChunk.name)
    private readonly chunks: Model<KnowledgeChunkDocument>,
    @InjectModel(KnowledgeAuditEvent.name)
    private readonly auditEvents: Model<KnowledgeAuditEventDocument>,
    @InjectModel(User.name)
    private readonly users: Model<UserDocument>,
    @InjectModel(Role.name)
    private readonly roles: Model<RoleDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly config: ConfigService,
    private readonly webApprovals: KnowledgeWebApprovalService,
    private readonly collections: KnowledgeCollectionService,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(MALWARE_SCAN_PROVIDER) private readonly malwareScan: MalwareScanProvider,
  ) {}

  /**
   * Best-effort audit write — never blocks or fails the operation it's
   * recording. metadata must stay shallow primitive values only (see
   * KnowledgeAuditEvent schema doc) — never document content, never a raw
   * error message, never a token.
   */
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
      this.logger.warn(`Failed to record knowledge audit event "${action}" for source ${String(sourceId)}.`);
    }
  }

  /** Strips the query string before an attempted-URL ever reaches an audit record — never log full sensitive query strings. */
  private safeUrlForAudit(rawUrl: string): string {
    try {
      const url = new URL(rawUrl);
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
      return '(unparseable url)';
    }
  }

  /** Confirms a user id refers to a real User in this org — never trusts a client-supplied id as-is. */
  private async assertOwnerInOrg(orgId: Types.ObjectId, ownerUserId: string): Promise<Types.ObjectId> {
    const id = new Types.ObjectId(ownerUserId);
    const exists = await this.users.exists({ _id: id, orgId });
    if (!exists) throw new BadRequestException('ownerUserId must be a user in this organization.');
    return id;
  }

  /** Confirms every role id refers to a real Role in this org — never trusts client-supplied ids as-is. */
  private async assertRolesInOrg(orgId: Types.ObjectId, roleIds: string[]): Promise<Types.ObjectId[]> {
    if (roleIds.length === 0) return [];
    const ids = roleIds.map((id) => new Types.ObjectId(id));
    const count = await this.roles.countDocuments({ _id: { $in: ids }, orgId });
    if (count !== ids.length) {
      throw new BadRequestException('accessRoleIds must all be roles that belong to this organization.');
    }
    return ids;
  }

  /**
   * Embeds whatever chunks are passed and writes the vectors back onto
   * those exact chunk documents (orgId-scoped update). Returns how many of
   * `pending` actually got embedded — embed() itself never throws (see
   * EmbeddingProvider doc), so a provider outage simply yields 0 rather
   * than an exception; callers decide whether that's worth surfacing.
   */
  private async embedPendingChunks(
    orgId: Types.ObjectId,
    pending: { _id: Types.ObjectId; text: string }[],
  ): Promise<number> {
    if (!pending.length) return 0;
    const vectors = await this.embeddings.embed(pending.map((c) => c.text));
    const ops = pending
      .map((c, i) => ({ id: c._id, vector: vectors[i] }))
      .filter((x): x is { id: Types.ObjectId; vector: number[] } => Array.isArray(x.vector))
      .map(({ id, vector }) => ({
        updateOne: {
          filter: { _id: id, orgId },
          update: {
            $set: { embedding: vector, embeddingModel: this.embeddings.modelName, embeddedAt: new Date() },
          },
        },
      }));
    if (ops.length) await this.chunks.bulkWrite(ops);
    return ops.length;
  }

  /** Fresh handle per use — cheap to construct, avoids any connection-timing assumptions. */
  private get bucket(): GridFSBucket {
    return new GridFSBucket(this.connection.db as Db, { bucketName: 'knowledge_files' });
  }

  private maxUploadBytes(): number {
    const configured = this.config.get<string>('KB_MAX_UPLOAD_BYTES');
    const parsed = configured ? Number(configured) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_BYTES;
  }

  private allowedMimeTypes(): string[] {
    const configured = this.config.get<string>('KB_ALLOWED_MIME_TYPES');
    if (!configured) return ALLOWED_MIME_TYPES;
    const list = configured.split(',').map((s) => s.trim()).filter(Boolean);
    return list.length ? list : ALLOWED_MIME_TYPES;
  }

  private configuredNumber(key: string, fallback: number): number {
    const configured = this.config.get<string>(key);
    const parsed = configured ? Number(configured) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private pdfExtractionLimits() {
    return {
      maxPages: this.configuredNumber('KB_MAX_PDF_PAGES', DEFAULT_PDF_EXTRACTION_LIMITS.maxPages),
      maxExtractedChars: this.configuredNumber(
        'KB_MAX_EXTRACTED_CHARS',
        DEFAULT_PDF_EXTRACTION_LIMITS.maxExtractedChars,
      ),
      timeoutMs: this.configuredNumber('KB_EXTRACTION_TIMEOUT_MS', DEFAULT_PDF_EXTRACTION_LIMITS.timeoutMs),
    };
  }

  private docxExtractionLimits() {
    return {
      maxExtractedChars: this.configuredNumber(
        'KB_MAX_EXTRACTED_CHARS',
        DEFAULT_DOCX_EXTRACTION_LIMITS.maxExtractedChars,
      ),
      timeoutMs: this.configuredNumber(
        'KB_EXTRACTION_TIMEOUT_MS',
        DEFAULT_DOCX_EXTRACTION_LIMITS.timeoutMs,
      ),
      zip: {
        maxEntries: this.configuredNumber(
          'KB_MAX_DOCX_ZIP_ENTRIES',
          DEFAULT_DOCX_EXTRACTION_LIMITS.zip.maxEntries,
        ),
        maxEntryUncompressedBytes: this.configuredNumber(
          'KB_MAX_DOCX_ENTRY_BYTES',
          DEFAULT_DOCX_EXTRACTION_LIMITS.zip.maxEntryUncompressedBytes,
        ),
        maxTotalUncompressedBytes: this.configuredNumber(
          'KB_MAX_DOCX_TOTAL_BYTES',
          DEFAULT_DOCX_EXTRACTION_LIMITS.zip.maxTotalUncompressedBytes,
        ),
        maxCompressionRatio: this.configuredNumber(
          'KB_MAX_DOCX_COMPRESSION_RATIO',
          DEFAULT_DOCX_EXTRACTION_LIMITS.zip.maxCompressionRatio,
        ),
      },
    };
  }

  private webFetchLimits() {
    return {
      maxRedirects: this.configuredNumber('KB_WEB_MAX_REDIRECTS', DEFAULT_WEB_FETCH_LIMITS.maxRedirects),
      maxResponseBytes: this.configuredNumber(
        'KB_WEB_MAX_RESPONSE_BYTES',
        DEFAULT_WEB_FETCH_LIMITS.maxResponseBytes,
      ),
      timeoutMs: this.configuredNumber('KB_WEB_FETCH_TIMEOUT_MS', DEFAULT_WEB_FETCH_LIMITS.timeoutMs),
    };
  }

  private webExtractionMaxChars(): number {
    return this.configuredNumber('KB_WEB_MAX_EXTRACTED_CHARS', MAX_WEB_EXTRACTED_CHARS_DEFAULT);
  }

  // ---------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------

  private parseOptionalDate(value: string | null | undefined): Date | null {
    if (value === undefined || value === null) return null;
    return new Date(value);
  }

  /** Server-side validation of the lifecycle dates — never trust the client to have ordered them sensibly. */
  private assertDateOrdering(effectiveAt: Date | null, expiresAt: Date | null): void {
    if (effectiveAt && expiresAt && expiresAt.getTime() <= effectiveAt.getTime()) {
      throw new BadRequestException('expiresAt must be after effectiveAt.');
    }
  }

  async upload(
    orgId: string,
    userId: string,
    file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    dto: UploadKnowledgeSourceDto,
  ): Promise<UploadResult> {
    // Validate before touching GridFS or Mongo at all — fail fast on bad input.
    if (!this.allowedMimeTypes().includes(file.mimetype)) {
      throw new UnsupportedMediaTypeException(
        `Unsupported file type "${file.mimetype}". Allowed: ${this.allowedMimeTypes().join(', ')}.`,
      );
    }
    const maxBytes = this.maxUploadBytes();
    if (file.size > maxBytes) {
      throw new PayloadTooLargeException(
        `File is ${file.size} bytes; the maximum allowed is ${maxBytes} bytes.`,
      );
    }
    // Magic-byte checks are necessary but explicitly NOT sufficient proof of
    // a safe file on their own — they only gate which parser we even
    // attempt. The real parser (further down the pipeline, in
    // processSource) still has to succeed, and its failure is handled
    // exactly like any other processing failure: 'failed' status, a safe
    // message, never a crash and never a partially-indexed source.
    if (file.mimetype === PDF_MIME_TYPE) {
      if (!looksLikePdf(file.buffer)) {
        throw new UnsupportedMediaTypeException('This file does not look like a valid PDF.');
      }
    } else if (file.mimetype === DOCX_MIME_TYPE) {
      if (!looksLikeDocx(file.buffer)) {
        throw new UnsupportedMediaTypeException('This file does not look like a valid DOCX document.');
      }
    } else if (looksLikeBinary(file.buffer)) {
      throw new UnsupportedMediaTypeException(
        'This file does not look like plain text or Markdown content.',
      );
    }

    // Integration boundary only — see MalwareScanProvider's doc comment.
    // In this deployment it always resolves to 'not_scanned'; it is called
    // here (before the file is ever stored) so that wiring in a real
    // scanner later is a provider swap, not a new call site to find.
    const malwareScanStatus = await this.malwareScan.scan(file.buffer, file.originalname);

    const orgObjectId = new Types.ObjectId(orgId);
    const contentHash = createHash('sha256').update(file.buffer).digest('hex');

    // Predictable duplicate handling: an exact byte-for-byte re-upload for
    // this org returns the existing source rather than creating a second
    // copy or an orphaned GridFS file.
    const existing = await this.sources.findOne({ orgId: orgObjectId, contentHash }).lean();
    if (existing) {
      await this.recordAudit(
        orgObjectId,
        existing._id as Types.ObjectId,
        new Types.ObjectId(userId),
        'duplicate_upload',
        'Re-uploaded bytes matched an existing source; no new source was created.',
      );
      return { source: this.toSourceDto(existing), duplicate: true };
    }

    // Validate referenced entities and date ordering before writing anything.
    const ownerUserId = dto.ownerUserId ? await this.assertOwnerInOrg(orgObjectId, dto.ownerUserId) : null;
    const accessRoleIds = await this.assertRolesInOrg(orgObjectId, dto.accessRoleIds ?? []);
    const effectiveAt = this.parseOptionalDate(dto.effectiveAt);
    const expiresAt = this.parseOptionalDate(dto.expiresAt);
    const reviewDueAt = this.parseOptionalDate(dto.reviewDueAt);
    this.assertDateOrdering(effectiveAt, expiresAt);
    if (dto.category) {
      await this.collections.assertCategoryAssignable(orgId, dto.category);
    }

    // Generate a safe internal identifier — never derived from the
    // client-supplied filename, which is untrusted.
    const safeInternalName = `${randomUUID()}-${file.originalname.replace(/[^\w.\-]/g, '_').slice(-80)}`;

    const gridFsFileId = await this.writeToGridFs(safeInternalName, file.buffer, file.mimetype);

    let sourceDoc: KnowledgeSourceDocument;
    try {
      sourceDoc = await this.sources.create({
        orgId: orgObjectId,
        title: dto.title?.trim() || file.originalname,
        description: dto.description?.trim() || null,
        status: 'processing',
        uploadedBy: new Types.ObjectId(userId),
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        contentHash,
        gridFsFileId,
        surfaces: dto.surfaces ?? [],
        processingError: null,
        version: 1,
        ownerUserId,
        category: dto.category ?? null,
        accessRoleIds,
        effectiveAt,
        expiresAt,
        reviewDueAt,
        malwareScanStatus,
      });
    } catch (err) {
      // Orphan prevention: metadata write failed after the file was already
      // stored — remove the now-unreferenced GridFS file rather than leak it.
      await this.bucket.delete(gridFsFileId).catch(() => {
        this.logger.warn(`Failed to clean up orphaned GridFS file after metadata write failure.`);
      });
      throw err;
    }

    await this.recordAudit(
      orgObjectId,
      sourceDoc._id as Types.ObjectId,
      new Types.ObjectId(userId),
      'uploaded',
      'New source uploaded; processing started.',
    );

    await this.processSource(sourceDoc);
    const refreshed = await this.sources.findById(sourceDoc._id).lean();
    return { source: this.toSourceDto(refreshed!), duplicate: false };
  }

  // ---------------------------------------------------------------------
  // Approved web-page ingestion
  // ---------------------------------------------------------------------

  /**
   * Fetches a page that matches an active approval entry for this org
   * (webApprovals.isUrlApproved — never an arbitrary caller-supplied URL)
   * and stores it through the exact same GridFS/KnowledgeSource/
   * processSource pipeline file uploads use. Mirrors upload()'s shape
   * deliberately (dedup-by-hash, orphan-prevention on a failed metadata
   * write, never auto-published) rather than sharing code with it, so
   * upload()'s already-verified behavior is never put at risk by this
   * addition.
   */
  async ingestApprovedWebPage(
    orgId: string,
    userId: string,
    dto: IngestWebPageDto,
  ): Promise<UploadResult> {
    const orgObjectId = new Types.ObjectId(orgId);
    const actorId = new Types.ObjectId(userId);

    let fetched: { html: Buffer; finalUrl: string };
    try {
      fetched = await fetchApprovedWebPage(
        dto.url,
        (candidateUrl: URL) => this.webApprovals.isUrlApproved(orgId, candidateUrl),
        this.webFetchLimits(),
      );
    } catch (err) {
      const safeOutcome = err instanceof WebFetchError ? err.message : 'The web page could not be fetched.';
      await this.recordAudit(orgObjectId, null, actorId, 'web_ingest_blocked', safeOutcome, {
        url: this.safeUrlForAudit(dto.url),
      });
      throw new BadRequestException(safeOutcome);
    }

    const buffer = fetched.html;
    const contentHash = createHash('sha256').update(buffer).digest('hex');

    // Same dedup semantics as upload(): an exact byte-for-byte re-ingest
    // returns the existing source rather than creating a second copy.
    const existing = await this.sources.findOne({ orgId: orgObjectId, contentHash }).lean();
    if (existing) {
      await this.recordAudit(
        orgObjectId,
        existing._id as Types.ObjectId,
        actorId,
        'duplicate_upload',
        'Re-ingested page matched an existing source; no new source was created.',
      );
      return { source: this.toSourceDto(existing), duplicate: true };
    }

    const ownerUserId = dto.ownerUserId ? await this.assertOwnerInOrg(orgObjectId, dto.ownerUserId) : null;
    const accessRoleIds = await this.assertRolesInOrg(orgObjectId, dto.accessRoleIds ?? []);
    const effectiveAt = this.parseOptionalDate(dto.effectiveAt);
    const expiresAt = this.parseOptionalDate(dto.expiresAt);
    const reviewDueAt = this.parseOptionalDate(dto.reviewDueAt);
    this.assertDateOrdering(effectiveAt, expiresAt);
    if (dto.category) {
      await this.collections.assertCategoryAssignable(orgId, dto.category);
    }

    const safeInternalName = `${randomUUID()}-web-page.html`;
    const gridFsFileId = await this.writeToGridFs(safeInternalName, buffer, WEB_PAGE_MIME_TYPE);

    let sourceDoc: KnowledgeSourceDocument;
    try {
      sourceDoc = await this.sources.create({
        orgId: orgObjectId,
        title: dto.title?.trim() || fetched.finalUrl,
        description: dto.description?.trim() || null,
        status: 'processing',
        uploadedBy: actorId,
        originalFilename: fetched.finalUrl,
        mimeType: WEB_PAGE_MIME_TYPE,
        sizeBytes: buffer.length,
        contentHash,
        gridFsFileId,
        surfaces: dto.surfaces ?? [],
        processingError: null,
        version: 1,
        ownerUserId,
        category: dto.category ?? null,
        accessRoleIds,
        effectiveAt,
        expiresAt,
        reviewDueAt,
      });
    } catch (err) {
      // Orphan prevention — same pattern as upload().
      await this.bucket.delete(gridFsFileId).catch(() => {
        this.logger.warn('Failed to clean up orphaned GridFS file after metadata write failure.');
      });
      throw err;
    }

    await this.recordAudit(
      orgObjectId,
      sourceDoc._id as Types.ObjectId,
      actorId,
      'uploaded',
      'Approved web page ingested; processing started.',
      { url: this.safeUrlForAudit(fetched.finalUrl) },
    );

    await this.processSource(sourceDoc);
    const refreshed = await this.sources.findById(sourceDoc._id).lean();
    return { source: this.toSourceDto(refreshed!), duplicate: false };
  }

  private async writeToGridFs(
    filename: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<Types.ObjectId> {
    return new Promise((resolve, reject) => {
      const uploadStream = this.bucket.openUploadStream(filename, {
        contentType: mimeType,
      });
      uploadStream.on('error', reject);
      uploadStream.on('finish', () => resolve(uploadStream.id as Types.ObjectId));
      uploadStream.end(buffer);
    });
  }

  /**
   * Extracts + chunks a source's content and transitions its status.
   * Never throws past this method — a processing failure is recorded on the
   * source (status: 'failed', a safe error summary) rather than left stuck
   * in 'processing' or propagated as an unhandled request error.
   */
  /**
   * Dispatches extraction by the source's already-validated mimeType.
   * TXT/Markdown keep their exact original behavior (unchanged call to
   * chunkText on the decoded text); PDF/DOCX reuse the same chunkText via
   * the extraction utility rather than duplicating chunking logic.
   */
  private async extractChunksForMimeType(
    mimeType: string,
    raw: Buffer,
  ): Promise<ExtractedChunk[]> {
    if (mimeType === PDF_MIME_TYPE) {
      const { chunks } = await extractPdfChunks(raw, this.pdfExtractionLimits());
      return chunks;
    }
    if (mimeType === DOCX_MIME_TYPE) {
      const { chunks } = await extractDocxChunks(raw, this.docxExtractionLimits());
      return chunks;
    }
    if (mimeType === WEB_PAGE_MIME_TYPE) {
      return extractWebPageChunks(raw.toString('utf-8'), this.webExtractionMaxChars());
    }
    const text = raw.toString('utf-8');
    const isMarkdown = mimeType === 'text/markdown';
    return chunkText(text, isMarkdown);
  }

  private async processSource(
    sourceDoc: KnowledgeSourceDocument,
    actorUserId?: Types.ObjectId,
  ): Promise<void> {
    // Attributed to whoever triggered this run — the uploader for the
    // initial pass, or the person who clicked "reprocess" for a retry.
    const actor = actorUserId ?? sourceDoc.uploadedBy;
    try {
      const raw = await this.readFromGridFs(sourceDoc.gridFsFileId);
      // The full chunk list is computed entirely in memory before anything
      // is written — if extraction throws partway through (over a page/size
      // limit, malformed content, etc.), insertMany below is never reached,
      // so a failed source can never end up with partially indexed,
      // retrievable chunks.
      const extracted = await this.extractChunksForMimeType(sourceDoc.mimeType, raw);

      if (extracted.length === 0) {
        sourceDoc.status = 'failed';
        sourceDoc.processingError = 'No extractable text content was found in this file.';
        await sourceDoc.save();
        await this.recordAudit(
          sourceDoc.orgId,
          sourceDoc._id as Types.ObjectId,
          actor,
          'processing_failed',
          sourceDoc.processingError,
        );
        return;
      }

      await this.chunks.insertMany(
        extracted.map((chunk, i) => ({
          orgId: sourceDoc.orgId,
          sourceId: sourceDoc._id,
          sourceVersion: sourceDoc.version,
          chunkIndex: i,
          text: chunk.text,
          charCount: chunk.text.length,
          section: chunk.section,
          // Real page numbers for PDF (set by the extraction utility); null
          // for TXT/Markdown/DOCX — honest, since none of those have pages.
          page: chunk.page ?? null,
        })),
      );

      sourceDoc.status = 'pending_review';
      sourceDoc.processingError = null;
      await sourceDoc.save();

      // Best-effort and never automatic-publishing: generating embeddings
      // (or failing to) has no effect on sourceDoc.status, which is already
      // saved above. Skipped entirely when no provider is configured, so
      // an environment without OPENAI_API_KEY pays zero extra cost and
      // falls back to keyword-only retrieval, exactly as before this
      // feature existed.
      if (this.embeddings.isConfigured) {
        try {
          const pending = await this.chunks
            .find({ orgId: sourceDoc.orgId, sourceId: sourceDoc._id, sourceVersion: sourceDoc.version })
            .select('_id text')
            .lean();
          await this.embedPendingChunks(sourceDoc.orgId, pending);
        } catch {
          this.logger.warn(
            `Embedding generation failed for knowledge source ${String(sourceDoc._id)}; retrieval falls back to keyword-only for this version.`,
          );
        }
      }
    } catch (err) {
      // Deliberately never log err.message or any file content — only that
      // processing failed, which source, and the error's type/name. A
      // DocumentExtractionError's .message is always one of our own
      // pre-written safe strings (never a raw parser exception), so it is
      // the one case where surfacing err.message directly is safe.
      const errorType = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(
        `Processing failed for knowledge source ${String(sourceDoc._id)} (${errorType}).`,
      );
      sourceDoc.status = 'failed';
      sourceDoc.processingError =
        err instanceof DocumentExtractionError
          ? err.message
          : 'Processing failed while extracting text from this file. You can retry from the source detail view.';
      await sourceDoc.save().catch(() => {
        this.logger.error(
          `Could not persist failed status for knowledge source ${String(sourceDoc._id)} — it may be stuck.`,
        );
      });
      await this.recordAudit(
        sourceDoc.orgId,
        sourceDoc._id as Types.ObjectId,
        actor,
        'processing_failed',
        sourceDoc.processingError,
      );
    }
  }

  private async readFromGridFs(fileId: Types.ObjectId): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      const downloadStream = this.bucket.openDownloadStream(fileId);
      downloadStream.on('data', (chunk) => chunks.push(chunk));
      downloadStream.on('error', reject);
      downloadStream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  async list(
    orgId: string,
    filter: { status?: string; surface?: KbSurface; reviewOverdue?: boolean } = {},
  ): Promise<KnowledgeSourceDto[]> {
    const query: Record<string, unknown> = { orgId: new Types.ObjectId(orgId) };
    if (filter.status) query.status = filter.status;
    if (filter.surface) query.surfaces = filter.surface;
    // reviewDueAt is informational only (never enforced at retrieval — see
    // the schema doc), so this filter is purely a visibility aid for an
    // owner/admin deciding what to re-review, not a gate on AI eligibility.
    if (filter.reviewOverdue) query.reviewDueAt = { $ne: null, $lte: new Date() };
    const docs = await this.sources.find(query).sort({ updatedAt: -1 }).lean();
    return docs.map((d) => this.toSourceDto(d));
  }

  async getOne(orgId: string, id: string): Promise<KnowledgeSourceDto> {
    const doc = await this.findOwnedOrThrow(orgId, id);
    return this.toSourceDto(doc.toObject() as unknown as Record<string, unknown>);
  }

  async listChunks(orgId: string, sourceId: string): Promise<KnowledgeChunkDto[]> {
    // Confirms the source itself belongs to this org before returning any
    // of its chunks — chunks are never queried by sourceId alone.
    const source = await this.findOwnedOrThrow(orgId, sourceId);
    const docs = await this.chunks
      .find({ orgId: source.orgId, sourceId: source._id, sourceVersion: source.version })
      .sort({ chunkIndex: 1 })
      .lean();
    return docs.map((d) => this.toChunkDto(d));
  }

  // ---------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------

  async updateMetadata(
    orgId: string,
    userId: string,
    id: string,
    dto: UpdateKnowledgeSourceDto,
  ): Promise<KnowledgeSourceDto> {
    const orgObjectId = new Types.ObjectId(orgId);
    const updates: Record<string, unknown> = {};
    const changedFields: string[] = [];
    if (dto.title !== undefined) {
      updates.title = dto.title.trim() || undefined;
      changedFields.push('title');
    }
    if (dto.description !== undefined) {
      updates.description = dto.description?.trim() || null;
      changedFields.push('description');
    }
    if (dto.surfaces !== undefined) {
      updates.surfaces = dto.surfaces;
      changedFields.push('surfaces');
    }
    if (dto.category !== undefined) {
      if (dto.category) {
        await this.collections.assertCategoryAssignable(orgId, dto.category);
      }
      updates.category = dto.category;
      changedFields.push('category');
    }
    if (dto.ownerUserId !== undefined) {
      updates.ownerUserId = dto.ownerUserId ? await this.assertOwnerInOrg(orgObjectId, dto.ownerUserId) : null;
      changedFields.push('ownerUserId');
    }
    if (dto.accessRoleIds !== undefined) {
      updates.accessRoleIds = await this.assertRolesInOrg(orgObjectId, dto.accessRoleIds);
      changedFields.push('accessRoleIds');
    }
    if (dto.effectiveAt !== undefined) {
      updates.effectiveAt = this.parseOptionalDate(dto.effectiveAt);
      changedFields.push('effectiveAt');
    }
    if (dto.expiresAt !== undefined) {
      updates.expiresAt = this.parseOptionalDate(dto.expiresAt);
      changedFields.push('expiresAt');
    }
    if (dto.reviewDueAt !== undefined) {
      updates.reviewDueAt = this.parseOptionalDate(dto.reviewDueAt);
      changedFields.push('reviewDueAt');
    }

    if ('effectiveAt' in updates || 'expiresAt' in updates) {
      const existing = await this.findOwnedOrThrow(orgId, id);
      const nextEffective = 'effectiveAt' in updates ? (updates.effectiveAt as Date | null) : existing.effectiveAt;
      const nextExpires = 'expiresAt' in updates ? (updates.expiresAt as Date | null) : existing.expiresAt;
      this.assertDateOrdering(nextEffective, nextExpires);
    }

    const doc = await this.sources
      .findOneAndUpdate(
        { _id: id, orgId: orgObjectId },
        { $set: updates },
        { new: true },
      )
      .lean();
    if (!doc) throw new NotFoundException('Knowledge source not found');

    if (changedFields.length) {
      await this.recordAudit(
        orgObjectId,
        doc._id as Types.ObjectId,
        new Types.ObjectId(userId),
        'metadata_updated',
        'Metadata updated.',
        { fields: changedFields.join(',') },
      );
    }

    return this.toSourceDto(doc);
  }

  async publish(orgId: string, userId: string, id: string): Promise<KnowledgeSourceDto> {
    const doc = await this.findOwnedOrThrow(orgId, id);
    if (doc.status !== 'pending_review') {
      throw new BadRequestException(
        `Only a source awaiting review can be published (current status: ${doc.status}).`,
      );
    }
    this.assertDateOrdering(doc.effectiveAt, doc.expiresAt);
    doc.status = 'published';
    doc.publishedBy = new Types.ObjectId(userId);
    doc.publishedAt = new Date();
    await doc.save();
    await this.recordAudit(
      doc.orgId,
      doc._id as Types.ObjectId,
      new Types.ObjectId(userId),
      'published',
      'Source published.',
    );
    return this.toSourceDto(doc.toObject() as unknown as Record<string, unknown>);
  }

  async archive(orgId: string, userId: string, id: string): Promise<KnowledgeSourceDto> {
    const doc = await this.findOwnedOrThrow(orgId, id);
    if (doc.status === 'archived') {
      throw new BadRequestException('This source is already archived.');
    }
    if (doc.status === 'processing') {
      throw new BadRequestException('Cannot archive a source that is still processing.');
    }
    doc.status = 'archived';
    doc.archivedBy = new Types.ObjectId(userId);
    doc.archivedAt = new Date();
    await doc.save();
    await this.recordAudit(
      doc.orgId,
      doc._id as Types.ObjectId,
      new Types.ObjectId(userId),
      'archived',
      'Source archived.',
    );
    return this.toSourceDto(doc.toObject() as unknown as Record<string, unknown>);
  }

  /**
   * Marks `id` as superseded by the already-published `dto.supersededBySourceId`.
   * Both sources must belong to this org (findOwnedOrThrow enforces that on
   * both lookups — this is what makes cross-org supersession impossible)
   * and `id` must currently be published — you supersede something that was
   * live, not a draft. The replacement must already be published too, so
   * there is never a window where the old source is marked superseded while
   * the new one hasn't actually passed review yet.
   *
   * No cache invalidation is needed or implemented: retrieveDocumentChunks
   * only ever queries sources with status:'published', so the instant this
   * save() resolves, the superseded source's chunks stop being eligible —
   * there is no cache in this architecture to go stale.
   */
  async supersede(
    orgId: string,
    userId: string,
    id: string,
    dto: SupersedeKnowledgeSourceDto,
  ): Promise<KnowledgeSourceDto> {
    if (id === dto.supersededBySourceId) {
      throw new BadRequestException('A source cannot supersede itself.');
    }
    const oldDoc = await this.findOwnedOrThrow(orgId, id);
    const newDoc = await this.findOwnedOrThrow(orgId, dto.supersededBySourceId);

    if (oldDoc.status !== 'published') {
      throw new BadRequestException(
        `Only a published source can be superseded (current status: ${oldDoc.status}).`,
      );
    }
    if (newDoc.status !== 'published') {
      throw new BadRequestException(
        'The replacement source must already be published before it can supersede another source.',
      );
    }

    oldDoc.status = 'superseded';
    oldDoc.supersededBySourceId = newDoc._id as Types.ObjectId;
    oldDoc.supersededBy = new Types.ObjectId(userId);
    oldDoc.supersededAt = new Date();
    await oldDoc.save();

    newDoc.supersedesSourceId = oldDoc._id as Types.ObjectId;
    await newDoc.save();

    await this.recordAudit(
      oldDoc.orgId,
      oldDoc._id as Types.ObjectId,
      new Types.ObjectId(userId),
      'superseded',
      'Source superseded by a replacement.',
      { supersededBySourceId: String(newDoc._id) },
    );

    return this.toSourceDto(oldDoc.toObject() as unknown as Record<string, unknown>);
  }

  async getAuditLog(orgId: string, sourceId: string): Promise<KnowledgeAuditEventDto[]> {
    // Confirms the source belongs to this org before returning any history —
    // same ownership-first pattern as listChunks.
    const source = await this.findOwnedOrThrow(orgId, sourceId);
    const docs = await this.auditEvents
      .find({ orgId: source.orgId, sourceId: source._id })
      .sort({ createdAt: -1 })
      .lean();
    return docs.map((d) => ({
      id: String(d._id),
      orgId: String(d.orgId),
      sourceId: String(d.sourceId),
      actorUserId: String(d.actorUserId),
      action: d.action,
      outcome: d.outcome,
      metadata: d.metadata ?? null,
      createdAt: (d as { createdAt?: Date }).createdAt?.toISOString() ?? new Date().toISOString(),
    }));
  }

  async reprocess(orgId: string, userId: string, id: string): Promise<KnowledgeSourceDto> {
    const doc = await this.findOwnedOrThrow(orgId, id);
    if (doc.status !== 'failed') {
      throw new BadRequestException(
        `Only a failed source can be reprocessed (current status: ${doc.status}).`,
      );
    }
    // Idempotent retry: clear out any partial chunks from the prior attempt
    // for this exact version before re-extracting, so a retry can never
    // double-write or leave inconsistent leftovers.
    await this.chunks.deleteMany({ orgId: doc.orgId, sourceId: doc._id, sourceVersion: doc.version });
    doc.status = 'processing';
    doc.processingError = null;
    await doc.save();
    // Reprocessing a failed source can only ever land on pending_review (or
    // failed again) — processSource() never sets status:'published', so a
    // previously-published version can never silently look current again
    // without passing review (in practice this path is unreachable from
    // 'published' anyway, since reprocess() requires status:'failed').
    await this.processSource(doc, new Types.ObjectId(userId));
    const refreshed = await this.sources.findById(doc._id).lean();
    await this.recordAudit(
      doc.orgId,
      doc._id as Types.ObjectId,
      new Types.ObjectId(userId),
      'reprocessed',
      `Reprocessing finished with status "${refreshed!.status}".`,
    );
    return this.toSourceDto(refreshed!);
  }

  /**
   * Explicit, non-automatic backfill/reindex: regenerates embeddings for
   * every CURRENT-version chunk of this source. Never runs on its own —
   * only this call site, which only an authenticated kb:write holder can
   * reach. Covers both "this chunk never got embedded" (created before
   * this feature existed, or a prior embed attempt silently failed) and
   * "re-embed after an embedding model/config change." Does not touch
   * sourceDoc.status — reindexing is purely an index-quality operation,
   * never a publication action.
   */
  async reindexEmbeddings(orgId: string, userId: string, id: string): Promise<KnowledgeSourceDto> {
    const doc = await this.findOwnedOrThrow(orgId, id);
    if (!this.embeddings.isConfigured) {
      throw new BadRequestException('No embedding provider is configured for this environment.');
    }
    const pending = await this.chunks
      .find({ orgId: doc.orgId, sourceId: doc._id, sourceVersion: doc.version })
      .select('_id text')
      .lean();
    const embeddedCount = await this.embedPendingChunks(doc.orgId, pending);
    await this.recordAudit(
      doc.orgId,
      doc._id as Types.ObjectId,
      new Types.ObjectId(userId),
      'embeddings_reindexed',
      `Embeddings regenerated for ${embeddedCount} of ${pending.length} chunk(s).`,
      { chunkCount: pending.length, embeddedCount },
    );
    return this.toSourceDto(doc.toObject() as unknown as Record<string, unknown>);
  }

  /**
   * Explicit, confirmed, one-way deletion — see KnowledgeSourceStatus's doc
   * comment for the retention model (tombstone row; chunks/embeddings/file
   * purged). Deliberately requires the source to already be in a
   * terminal, non-retrievable state (archived/superseded/failed) before it
   * can be deleted: a live 'published' or in-flight 'processing'/
   * 'pending_review' source must be archived first, so deletion is never
   * someone's only way to pull a source out of active use.
   *
   * Ordering matters for safety under partial failure: status flips to
   * 'deleted' FIRST, in a single atomic save — this is what guarantees a
   * failed/interrupted deletion can never leave the source retrievable
   * (retrieveDocumentChunks only ever queries status:'published', so
   * 'deleted' excludes it exactly like 'archived' already does, with no
   * separate cache to invalidate). Everything after that point
   * (chunk/embedding removal, GridFS cleanup) is naturally idempotent —
   * deleting rows or a file that are already gone is a safe no-op — so
   * calling delete() again on an already-'deleted' source (the retry path
   * after a partial failure) is explicitly allowed, not rejected.
   */
  async delete(
    orgId: string,
    userId: string,
    id: string,
    dto: DeleteKnowledgeSourceDto,
  ): Promise<KnowledgeSourceDto> {
    if (dto.confirm !== true) {
      throw new BadRequestException('Deletion requires explicit confirmation (confirm: true).');
    }
    const doc = await this.findOwnedOrThrow(orgId, id);
    const deletableStatuses: KnowledgeSourceDocument['status'][] = [
      'archived',
      'superseded',
      'failed',
      'deleted',
    ];
    if (!deletableStatuses.includes(doc.status)) {
      throw new BadRequestException(
        `Only an archived, superseded, or failed source can be deleted (current status: ${doc.status}). Archive it first.`,
      );
    }

    const wasAlreadyDeleted = doc.status === 'deleted';
    doc.status = 'deleted';
    doc.deletedBy = new Types.ObjectId(userId);
    doc.deletedAt = doc.deletedAt ?? new Date();
    await doc.save();

    // Removes searchable chunks AND their embeddings (embeddings live on
    // the chunk document, not a separate store) for every version of this
    // source, not just the current one — a no-op if already removed.
    await this.chunks.deleteMany({ orgId: doc.orgId, sourceId: doc._id });

    await this.bucket.delete(doc.gridFsFileId).catch(() => {
      this.logger.warn(
        `GridFS file already absent (or never existed) for deleted knowledge source ${String(doc._id)} — safe to ignore on a retry.`,
      );
    });

    if (!wasAlreadyDeleted) {
      await this.recordAudit(
        doc.orgId,
        doc._id as Types.ObjectId,
        new Types.ObjectId(userId),
        'deleted',
        'Source deleted: chunks, embeddings, and the underlying file were removed.',
      );
    }
    return this.toSourceDto(doc.toObject() as unknown as Record<string, unknown>);
  }

  private async findOwnedOrThrow(orgId: string, id: string): Promise<KnowledgeSourceDocument> {
    const doc = await this.sources.findOne({ _id: id, orgId: new Types.ObjectId(orgId) });
    if (!doc) throw new NotFoundException('Knowledge source not found');
    return doc;
  }

  // ---------------------------------------------------------------------
  // DTO mapping
  // ---------------------------------------------------------------------

  private toSourceDto(d: Record<string, unknown>): KnowledgeSourceDto {
    const createdAt =
      d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date().toISOString();
    const updatedAt = d.updatedAt instanceof Date ? d.updatedAt.toISOString() : createdAt;
    return {
      id: String(d._id),
      orgId: String(d.orgId),
      title: String(d.title),
      description: (d.description as string | null) ?? null,
      status: d.status as KnowledgeSourceDto['status'],
      uploadedBy: String(d.uploadedBy),
      originalFilename: String(d.originalFilename),
      mimeType: String(d.mimeType),
      sizeBytes: Number(d.sizeBytes ?? 0),
      contentHash: String(d.contentHash),
      surfaces: Array.isArray(d.surfaces) ? (d.surfaces as KbSurface[]) : [],
      processingError: (d.processingError as string | null) ?? null,
      version: Number(d.version ?? 1),
      publishedBy: d.publishedBy ? String(d.publishedBy) : null,
      publishedAt: d.publishedAt instanceof Date ? d.publishedAt.toISOString() : null,
      archivedBy: d.archivedBy ? String(d.archivedBy) : null,
      archivedAt: d.archivedAt instanceof Date ? d.archivedAt.toISOString() : null,
      ownerUserId: d.ownerUserId ? String(d.ownerUserId) : null,
      category: (d.category as KnowledgeSourceDto['category']) ?? null,
      accessRoleIds: Array.isArray(d.accessRoleIds) ? d.accessRoleIds.map((r) => String(r)) : [],
      effectiveAt: d.effectiveAt instanceof Date ? d.effectiveAt.toISOString() : null,
      expiresAt: d.expiresAt instanceof Date ? d.expiresAt.toISOString() : null,
      reviewDueAt: d.reviewDueAt instanceof Date ? d.reviewDueAt.toISOString() : null,
      supersedesSourceId: d.supersedesSourceId ? String(d.supersedesSourceId) : null,
      supersededBySourceId: d.supersededBySourceId ? String(d.supersededBySourceId) : null,
      supersededBy: d.supersededBy ? String(d.supersededBy) : null,
      supersededAt: d.supersededAt instanceof Date ? d.supersededAt.toISOString() : null,
      deletedBy: d.deletedBy ? String(d.deletedBy) : null,
      deletedAt: d.deletedAt instanceof Date ? d.deletedAt.toISOString() : null,
      malwareScanStatus: (d.malwareScanStatus as KnowledgeSourceDto['malwareScanStatus']) ?? 'not_scanned',
      createdAt,
      updatedAt,
    };
  }

  private toChunkDto(d: Record<string, unknown>): KnowledgeChunkDto {
    const createdAt =
      d.createdAt instanceof Date ? d.createdAt.toISOString() : new Date().toISOString();
    return {
      id: String(d._id),
      orgId: String(d.orgId),
      sourceId: String(d.sourceId),
      sourceVersion: Number(d.sourceVersion ?? 1),
      chunkIndex: Number(d.chunkIndex ?? 0),
      text: String(d.text ?? ''),
      charCount: Number(d.charCount ?? 0),
      section: (d.section as string | null) ?? null,
      page: (d.page as number | null) ?? null,
      createdAt,
    };
  }
}
