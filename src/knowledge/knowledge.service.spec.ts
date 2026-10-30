import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, Model, Types } from 'mongoose';
import { KnowledgeChunkDocument } from '../schemas/knowledge-chunk.schema';
import { KnowledgeSourceDocument } from '../schemas/knowledge-source.schema';
import { KnowledgeService } from './knowledge.service';
import { WebFetchError } from './web-ssrf-guard.util';

// fetchApprovedWebPage's own orchestration (redirects, timeouts, size
// limits, SSRF enforcement) is already exhaustively tested in isolation
// in web-fetch.util.spec.ts — mocked here so KnowledgeService's tests
// only verify its OWN orchestration around whatever that function
// returns or throws, not re-test the fetch internals.
const fetchApprovedWebPageMock = jest.fn();
jest.mock('./web-fetch.util', () => ({
  ...jest.requireActual('./web-fetch.util'),
  fetchApprovedWebPage: (...args: unknown[]) => fetchApprovedWebPageMock(...args),
}));

type WriteToGridFsFn = (filename: string, buffer: Buffer, mimeType: string) => Promise<Types.ObjectId>;
type ProcessSourceFn = (doc: ReturnType<typeof makeHydratedSource>) => Promise<void>;
type ReadFromGridFsFn = (fileId: Types.ObjectId) => Promise<Buffer>;
type BucketGetter = { delete: jest.Mock };

function leanChain<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function sortLeanChain<T>(value: T) {
  return { sort: jest.fn().mockReturnValue(leanChain(value)) };
}

function selectLeanChain<T>(value: T) {
  return { select: jest.fn().mockReturnValue(leanChain(value)) };
}

/** A fake hydrated Mongoose document: plain fields plus save()/toObject(). */
function makeHydratedSource(overrides: Partial<Record<string, unknown>> = {}) {
  const base: Record<string, unknown> = {
    _id: new Types.ObjectId(),
    orgId: new Types.ObjectId(),
    title: 'Doc title',
    description: null,
    status: 'pending_review',
    uploadedBy: new Types.ObjectId(),
    originalFilename: 'doc.txt',
    mimeType: 'text/plain',
    sizeBytes: 10,
    contentHash: 'hash',
    gridFsFileId: new Types.ObjectId(),
    surfaces: [],
    processingError: null,
    version: 1,
    publishedBy: null,
    publishedAt: null,
    archivedBy: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  const doc = {
    ...base,
    save: jest.fn().mockResolvedValue(undefined),
    toObject: jest.fn(),
  } as Record<string, unknown> & { save: jest.Mock; toObject: jest.Mock };
  doc.toObject.mockImplementation(() => {
    const { save: _save, toObject: _toObject, ...plain } = doc;
    return plain;
  });
  return doc;
}

function makeConfig(values: Record<string, string> = {}): ConfigService {
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService;
}

type SourceModelMock = {
  findOne: jest.Mock;
  find: jest.Mock;
  findById: jest.Mock;
  findOneAndUpdate: jest.Mock;
  create: jest.Mock;
};
type ChunkModelMock = {
  find: jest.Mock;
  insertMany: jest.Mock;
  deleteMany: jest.Mock;
  bulkWrite: jest.Mock;
};
type AuditModelMock = { create: jest.Mock; find: jest.Mock };
type UserModelMock = { exists: jest.Mock };
type RoleModelMock = { countDocuments: jest.Mock };

function makeService(opts: {
  config?: Record<string, string>;
  sourceOverrides?: Partial<SourceModelMock>;
  chunkOverrides?: Partial<ChunkModelMock>;
  auditOverrides?: Partial<AuditModelMock>;
  userOverrides?: Partial<UserModelMock>;
  roleOverrides?: Partial<RoleModelMock>;
  webApprovalsOverrides?: { isUrlApproved?: jest.Mock };
  collectionsOverrides?: { assertCategoryAssignable?: jest.Mock };
  embeddingsOverrides?: { isConfigured?: boolean; modelName?: string; embed?: jest.Mock };
  malwareScanOverrides?: { isConfigured?: boolean; scan?: jest.Mock };
} = {}) {
  const sources: SourceModelMock = {
    findOne: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn(),
    ...opts.sourceOverrides,
  };
  const chunks: ChunkModelMock = {
    find: jest.fn(),
    insertMany: jest.fn().mockResolvedValue(undefined),
    deleteMany: jest.fn().mockResolvedValue(undefined),
    bulkWrite: jest.fn().mockResolvedValue(undefined),
    ...opts.chunkOverrides,
  };
  // Defaults so existing tests that don't care about audit/owner/role
  // validation never have to configure them: audit writes always "succeed"
  // (best-effort, never blocks the real operation), and an unset
  // ownerUserId/accessRoleIds never even reaches these models.
  const auditEvents: AuditModelMock = {
    create: jest.fn().mockResolvedValue({}),
    find: jest.fn(),
    ...opts.auditOverrides,
  };
  const users: UserModelMock = {
    exists: jest.fn().mockResolvedValue(true),
    ...opts.userOverrides,
  };
  const roles: RoleModelMock = {
    countDocuments: jest.fn().mockImplementation((q: { _id: { $in: unknown[] } }) => q._id.$in.length),
    ...opts.roleOverrides,
  };
  // Default: everything is "approved" so existing tests unrelated to web
  // ingestion never have to configure this; web-ingestion tests override
  // it explicitly per scenario.
  const webApprovals = {
    isUrlApproved: jest.fn().mockResolvedValue(true),
    ...opts.webApprovalsOverrides,
  } as unknown as import('./knowledge-web-approval.service').KnowledgeWebApprovalService;
  // Default: every category assignment is allowed, so existing tests that
  // don't care about collection governance never have to configure this.
  const collections = {
    assertCategoryAssignable: jest.fn().mockResolvedValue(undefined),
    ...opts.collectionsOverrides,
  } as unknown as import('./knowledge-collection.service').KnowledgeCollectionService;
  // Default: no embedding provider configured — the safe, zero-cost default
  // for this repo (OPENAI_API_KEY is unset in .env). Tests that care about
  // embedding generation override this explicitly.
  const embeddings = {
    isConfigured: false,
    modelName: 'test-embedding-model',
    embed: jest.fn().mockResolvedValue([]),
    ...opts.embeddingsOverrides,
  } as unknown as import('../ai/embedding/embedding-provider').EmbeddingProvider;
  // Default: the real no-op provider's behavior — never scans, always
  // 'not_scanned'. Matches production default (no scanner is configured).
  const malwareScan = {
    isConfigured: false,
    scan: jest.fn().mockResolvedValue('not_scanned'),
    ...opts.malwareScanOverrides,
  } as unknown as import('./malware-scan-provider').MalwareScanProvider;
  const connection = {} as unknown as Connection;
  const service = new KnowledgeService(
    sources as unknown as Model<KnowledgeSourceDocument>,
    chunks as unknown as Model<KnowledgeChunkDocument>,
    auditEvents as unknown as Model<import('../schemas/knowledge-audit-event.schema').KnowledgeAuditEventDocument>,
    users as unknown as Model<import('../schemas/user.schema').UserDocument>,
    roles as unknown as Model<import('../schemas/role.schema').RoleDocument>,
    connection,
    makeConfig(opts.config),
    webApprovals,
    collections,
    embeddings,
    malwareScan,
  );
  return { service, sources, chunks, auditEvents, users, roles, webApprovals, collections, embeddings, malwareScan };
}

const ORG_ID = new Types.ObjectId().toString();
const USER_ID = new Types.ObjectId().toString();

function makeFile(overrides: Partial<{ originalname: string; mimetype: string; size: number; buffer: Buffer }> = {}) {
  return {
    originalname: 'notes.txt',
    mimetype: 'text/plain',
    size: 20,
    buffer: Buffer.from('Some plain text content.'),
    ...overrides,
  };
}

describe('KnowledgeService.upload — validation', () => {
  it('rejects a disallowed mime type before touching GridFS or Mongo', async () => {
    const { service, sources } = makeService();
    await expect(
      service.upload(ORG_ID, USER_ID, makeFile({ mimetype: 'application/pdf' }), {}),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(sources.findOne).not.toHaveBeenCalled();
  });

  it('rejects a file over the configured size limit', async () => {
    const { service } = makeService({ config: { KB_MAX_UPLOAD_BYTES: '100' } });
    await expect(
      service.upload(ORG_ID, USER_ID, makeFile({ size: 101 }), {}),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('falls back to the 2MB default when the configured limit is not a valid positive number', async () => {
    const { service } = makeService({ config: { KB_MAX_UPLOAD_BYTES: 'not-a-number' } });
    await expect(
      service.upload(ORG_ID, USER_ID, makeFile({ size: 2 * 1024 * 1024 + 1 }), {}),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('rejects content that looks binary even if the declared mime type is allowed', async () => {
    const { service } = makeService();
    const binaryBuffer = Buffer.concat([Buffer.from('looks like text'), Buffer.from([0x00])]);
    await expect(
      service.upload(ORG_ID, USER_ID, makeFile({ buffer: binaryBuffer }), {}),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('respects a configured custom allowlist of mime types', async () => {
    const { service, sources } = makeService({ config: { KB_ALLOWED_MIME_TYPES: 'text/csv' } });
    sources.findOne.mockReturnValue(leanChain(null));
    jest.spyOn(service as unknown as { writeToGridFs: WriteToGridFsFn }, 'writeToGridFs')
      .mockResolvedValue(new Types.ObjectId());
    jest.spyOn(service as unknown as { processSource: ProcessSourceFn }, 'processSource')
      .mockResolvedValue(undefined);
    sources.create.mockResolvedValue(makeHydratedSource());
    sources.findById.mockReturnValue(leanChain(makeHydratedSource()));

    await expect(
      service.upload(ORG_ID, USER_ID, makeFile({ mimetype: 'text/plain' }), {}),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);

    await expect(
      service.upload(ORG_ID, USER_ID, makeFile({ mimetype: 'text/csv' }), {}),
    ).resolves.toMatchObject({ duplicate: false });
  });
});

describe('KnowledgeService.upload — dedup and creation', () => {
  it('returns the existing source without re-uploading on an exact byte-for-byte duplicate', async () => {
    const existing = makeHydratedSource().toObject();
    const { service, sources } = makeService({ sourceOverrides: {} });
    sources.findOne.mockReturnValue(leanChain(existing));
    const writeSpy = jest.spyOn(
      service as unknown as { writeToGridFs: WriteToGridFsFn },
      'writeToGridFs',
    );

    const result = await service.upload(ORG_ID, USER_ID, makeFile(), {});

    expect(result.duplicate).toBe(true);
    expect(result.source.id).toBe(String(existing._id));
    expect(writeSpy).not.toHaveBeenCalled();
    expect(sources.create).not.toHaveBeenCalled();
  });

  it('scans the uploaded bytes and persists whatever status the provider returns', async () => {
    const { service, sources, malwareScan } = makeService({
      malwareScanOverrides: { scan: jest.fn().mockResolvedValue('not_scanned') },
    });
    sources.findOne.mockReturnValue(leanChain(null));
    jest
      .spyOn(service as unknown as { writeToGridFs: WriteToGridFsFn }, 'writeToGridFs')
      .mockResolvedValue(new Types.ObjectId());
    jest.spyOn(service as unknown as { processSource: ProcessSourceFn }, 'processSource').mockResolvedValue(undefined);
    sources.create.mockResolvedValue(makeHydratedSource());
    sources.findById.mockReturnValue(leanChain(makeHydratedSource()));
    const file = makeFile();

    await service.upload(ORG_ID, USER_ID, file, {});

    expect(malwareScan.scan).toHaveBeenCalledWith(file.buffer, file.originalname);
    expect(sources.create.mock.calls[0][0].malwareScanStatus).toBe('not_scanned');
  });

  it('never claims a file was scanned when no scanner is configured — defaults to not_scanned, never clean', async () => {
    const { service, sources } = makeService(); // default malwareScan mock: not_scanned
    sources.findOne.mockReturnValue(leanChain(null));
    jest
      .spyOn(service as unknown as { writeToGridFs: WriteToGridFsFn }, 'writeToGridFs')
      .mockResolvedValue(new Types.ObjectId());
    jest.spyOn(service as unknown as { processSource: ProcessSourceFn }, 'processSource').mockResolvedValue(undefined);
    sources.create.mockResolvedValue(makeHydratedSource());
    sources.findById.mockReturnValue(leanChain(makeHydratedSource()));

    await service.upload(ORG_ID, USER_ID, makeFile(), {});

    expect(sources.create.mock.calls[0][0].malwareScanStatus).toBe('not_scanned');
    expect(sources.create.mock.calls[0][0].malwareScanStatus).not.toBe('clean');
  });

  it('rejects the upload before writing anything when the target collection is archived', async () => {
    const { service, sources, collections } = makeService({
      collectionsOverrides: {
        assertCategoryAssignable: jest.fn().mockRejectedValue(new BadRequestException('archived')),
      },
    });
    sources.findOne.mockReturnValue(leanChain(null));
    const writeSpy = jest.spyOn(
      service as unknown as { writeToGridFs: WriteToGridFsFn },
      'writeToGridFs',
    );

    await expect(
      service.upload(ORG_ID, USER_ID, makeFile(), { category: 'hr_people' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(collections.assertCategoryAssignable).toHaveBeenCalledWith(ORG_ID, 'hr_people');
    expect(writeSpy).not.toHaveBeenCalled();
    expect(sources.create).not.toHaveBeenCalled();
  });

  it('never derives the GridFS internal filename from the raw, untrusted client filename', async () => {
    const { service, sources } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    const writeSpy = jest
      .spyOn(service as unknown as { writeToGridFs: WriteToGridFsFn }, 'writeToGridFs')
      .mockResolvedValue(new Types.ObjectId());
    jest.spyOn(service as unknown as { processSource: ProcessSourceFn }, 'processSource')
      .mockResolvedValue(undefined);
    sources.create.mockResolvedValue(makeHydratedSource());
    sources.findById.mockReturnValue(leanChain(makeHydratedSource()));

    const maliciousName = '../../../etc/passwd; rm -rf /';
    await service.upload(ORG_ID, USER_ID, makeFile({ originalname: maliciousName }), {});

    const [safeInternalName] = writeSpy.mock.calls[0] as [string, Buffer, string];
    // The GridFS filename is metadata, not a filesystem path, so "../" itself
    // is not a traversal risk here — what matters is that path/shell
    // separators are stripped and a random UUID prefix is always present,
    // so the stored name can never collide with or be predicted from another
    // upload's raw client-supplied filename.
    expect(safeInternalName).not.toContain('/');
    expect(safeInternalName).not.toContain(';');
    expect(safeInternalName).toMatch(/^[0-9a-f-]{36}-/);
  });

  it('creates the source with orgId/uploadedBy taken from the trusted method parameters, not the DTO', async () => {
    const { service, sources } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    jest.spyOn(service as unknown as { writeToGridFs: WriteToGridFsFn }, 'writeToGridFs')
      .mockResolvedValue(new Types.ObjectId());
    jest.spyOn(service as unknown as { processSource: ProcessSourceFn }, 'processSource')
      .mockResolvedValue(undefined);
    sources.create.mockResolvedValue(makeHydratedSource());
    sources.findById.mockReturnValue(leanChain(makeHydratedSource()));

    await service.upload(ORG_ID, USER_ID, makeFile(), { title: 'My title', surfaces: ['assistant'] });

    const createArgs = sources.create.mock.calls[0][0];
    expect(createArgs.orgId.toString()).toBe(ORG_ID);
    expect(createArgs.uploadedBy.toString()).toBe(USER_ID);
    expect(createArgs.title).toBe('My title');
    expect(createArgs.surfaces).toEqual(['assistant']);
    expect(createArgs.status).toBe('processing');
  });

  it('cleans up the GridFS file if the metadata write fails afterward (orphan prevention)', async () => {
    const { service, sources } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    const fileId = new Types.ObjectId();
    jest.spyOn(service as unknown as { writeToGridFs: WriteToGridFsFn }, 'writeToGridFs')
      .mockResolvedValue(fileId);
    const deleteMock = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(service as unknown as { bucket: BucketGetter }, 'bucket', 'get')
      .mockReturnValue({ delete: deleteMock });
    sources.create.mockRejectedValue(new Error('metadata write failed'));

    await expect(service.upload(ORG_ID, USER_ID, makeFile(), {})).rejects.toThrow(
      'metadata write failed',
    );
    expect(deleteMock).toHaveBeenCalledWith(fileId);
  });
});

describe('KnowledgeService.processSource', () => {
  function castInternal(service: KnowledgeService) {
    return service as unknown as {
      processSource: ProcessSourceFn;
    };
  }

  it('transitions to pending_review and writes chunks when extraction succeeds', async () => {
    const { service, chunks } = makeService();
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockResolvedValue(Buffer.from('Paragraph one.\n\nParagraph two.'));
    const doc = makeHydratedSource({ status: 'processing' });

    await castInternal(service).processSource(doc);

    expect(chunks.insertMany).toHaveBeenCalled();
    const inserted = chunks.insertMany.mock.calls[0][0];
    expect(inserted.length).toBeGreaterThan(0);
    expect(inserted[0].orgId).toBe(doc.orgId);
    expect(inserted[0].sourceId).toBe(doc._id);
    expect(doc.status).toBe('pending_review');
    expect(doc.processingError).toBeNull();
    expect(doc.save).toHaveBeenCalled();
  });

  it('marks the source failed with a safe message when no text content can be extracted', async () => {
    const { service, chunks } = makeService();
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockResolvedValue(Buffer.from('   \n\n   '));
    const doc = makeHydratedSource({ status: 'processing' });

    await castInternal(service).processSource(doc);

    expect(chunks.insertMany).not.toHaveBeenCalled();
    expect(doc.status).toBe('failed');
    expect(doc.processingError).toMatch(/no extractable text/i);
  });

  it('marks the source failed with a generic message and never logs the raw error or file content on an unexpected failure', async () => {
    const { service } = makeService();
    const sensitiveContent = 'EMPLOYEE SSN 123-45-6789 secret details';
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockRejectedValue(new Error(sensitiveContent));
    const warnSpy = jest.spyOn((service as unknown as { logger: { warn: jest.Mock } }).logger, 'warn');
    const doc = makeHydratedSource({ status: 'processing' });

    await castInternal(service).processSource(doc);

    expect(doc.status).toBe('failed');
    expect(doc.processingError).not.toContain(sensitiveContent);
    for (const call of warnSpy.mock.calls) {
      expect(String(call[0])).not.toContain(sensitiveContent);
    }
  });

  it('never attempts embedding generation when no provider is configured — zero extra cost by default', async () => {
    const { service, chunks, embeddings } = makeService({ embeddingsOverrides: { isConfigured: false } });
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockResolvedValue(Buffer.from('Paragraph one.\n\nParagraph two.'));
    const doc = makeHydratedSource({ status: 'processing' });

    await castInternal(service).processSource(doc);

    expect(chunks.find).not.toHaveBeenCalled();
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it('embeds freshly-inserted chunks and writes vectors back when a provider is configured', async () => {
    const chunkId = new Types.ObjectId();
    const { service, chunks, embeddings } = makeService({
      embeddingsOverrides: {
        isConfigured: true,
        embed: jest.fn().mockResolvedValue([[0.1, 0.2]]),
      },
      chunkOverrides: {
        find: jest.fn().mockReturnValue(selectLeanChain([{ _id: chunkId, text: 'Paragraph one.' }])),
      },
    });
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockResolvedValue(Buffer.from('Paragraph one.\n\nParagraph two.'));
    const doc = makeHydratedSource({ status: 'processing' });

    await castInternal(service).processSource(doc);

    expect(embeddings.embed).toHaveBeenCalledWith(['Paragraph one.']);
    expect(chunks.bulkWrite).toHaveBeenCalled();
    const ops = chunks.bulkWrite.mock.calls[0][0];
    expect(ops[0].updateOne.filter).toEqual({ _id: chunkId, orgId: doc.orgId });
    expect(ops[0].updateOne.update.$set.embedding).toEqual([0.1, 0.2]);
  });

  it('never fails source processing when embedding generation throws — status stays pending_review', async () => {
    const { service, embeddings } = makeService({
      embeddingsOverrides: {
        isConfigured: true,
        embed: jest.fn().mockRejectedValue(new Error('provider outage')),
      },
      chunkOverrides: {
        find: jest.fn().mockReturnValue(selectLeanChain([{ _id: new Types.ObjectId(), text: 'x' }])),
      },
    });
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockResolvedValue(Buffer.from('Paragraph one.\n\nParagraph two.'));
    const doc = makeHydratedSource({ status: 'processing' });

    await castInternal(service).processSource(doc);

    expect(doc.status).toBe('pending_review');
    void embeddings;
  });

  it('never writes a vector for a chunk the provider failed to embed', async () => {
    const chunkId = new Types.ObjectId();
    const { service, chunks } = makeService({
      embeddingsOverrides: { isConfigured: true, embed: jest.fn().mockResolvedValue([null]) },
      chunkOverrides: {
        find: jest.fn().mockReturnValue(selectLeanChain([{ _id: chunkId, text: 'Paragraph one.' }])),
      },
    });
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockResolvedValue(Buffer.from('Paragraph one.\n\nParagraph two.'));
    const doc = makeHydratedSource({ status: 'processing' });

    await castInternal(service).processSource(doc);

    expect(chunks.bulkWrite).not.toHaveBeenCalled();
  });
});

describe('KnowledgeService.reindexEmbeddings', () => {
  it('rejects when no embedding provider is configured, without touching any chunks', async () => {
    const { service, sources, chunks } = makeService({ embeddingsOverrides: { isConfigured: false } });
    const doc = makeHydratedSource();
    sources.findOne.mockResolvedValue(doc);

    await expect(service.reindexEmbeddings(ORG_ID, USER_ID, String(doc._id))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(chunks.find).not.toHaveBeenCalled();
  });

  it('re-embeds every current-version chunk and records an embeddings_reindexed audit event', async () => {
    const chunkId = new Types.ObjectId();
    const { service, sources, chunks, auditEvents } = makeService({
      embeddingsOverrides: { isConfigured: true, embed: jest.fn().mockResolvedValue([[0.5]]) },
      chunkOverrides: {
        find: jest.fn().mockReturnValue(selectLeanChain([{ _id: chunkId, text: 'Current text.' }])),
      },
    });
    const doc = makeHydratedSource();
    sources.findOne.mockResolvedValue(doc);

    const result = await service.reindexEmbeddings(ORG_ID, USER_ID, String(doc._id));

    expect(chunks.bulkWrite).toHaveBeenCalled();
    expect(result.id).toBe(String(doc._id));
    expect(auditEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'embeddings_reindexed',
        metadata: expect.objectContaining({ chunkCount: 1, embeddedCount: 1 }),
      }),
    );
  });

  it('only reindexes chunks belonging to this org (scoped query, not by id alone)', async () => {
    const { service, sources, chunks } = makeService({
      embeddingsOverrides: { isConfigured: true, embed: jest.fn().mockResolvedValue([]) },
    });
    chunks.find.mockReturnValue(selectLeanChain([]));
    const doc = makeHydratedSource();
    sources.findOne.mockResolvedValue(doc);

    await service.reindexEmbeddings(ORG_ID, USER_ID, String(doc._id));

    const query = chunks.find.mock.calls[0][0];
    expect(query.orgId).toBe(doc.orgId);
    expect(query.sourceId).toBe(doc._id);
    expect(query.sourceVersion).toBe(doc.version);
  });

  it('throws NotFoundException for a source that does not belong to this org', async () => {
    const { service, sources } = makeService({ embeddingsOverrides: { isConfigured: true } });
    sources.findOne.mockResolvedValue(null);
    await expect(service.reindexEmbeddings(ORG_ID, USER_ID, 'anything')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('KnowledgeService — read access is org-scoped', () => {
  it('getOne looks up by both _id and orgId together, never by id alone', async () => {
    const { service, sources } = makeService();
    const doc = makeHydratedSource();
    sources.findOne.mockResolvedValue(doc);

    await service.getOne(ORG_ID, String(doc._id));

    const queryArg = sources.findOne.mock.calls[0][0];
    expect(queryArg.orgId.toString()).toBe(ORG_ID);
    expect(queryArg._id).toBe(String(doc._id));
  });

  it('throws NotFoundException when no source matches this org', async () => {
    const { service, sources } = makeService();
    sources.findOne.mockResolvedValue(null);
    await expect(service.getOne(ORG_ID, new Types.ObjectId().toString())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('listChunks verifies the parent source belongs to the org before reading chunks', async () => {
    const { service, sources, chunks } = makeService();
    const doc = makeHydratedSource();
    sources.findOne.mockResolvedValue(doc);
    chunks.find.mockReturnValue(sortLeanChain([]));

    await service.listChunks(ORG_ID, String(doc._id));

    const chunkQuery = chunks.find.mock.calls[0][0];
    expect(chunkQuery.orgId).toBe(doc.orgId);
    expect(chunkQuery.sourceId).toBe(doc._id);
    expect(chunkQuery.sourceVersion).toBe(doc.version);
  });
});

describe('KnowledgeService — lifecycle transitions', () => {
  it('publish() only succeeds from pending_review', async () => {
    const { service, sources } = makeService();
    const doc = makeHydratedSource({ status: 'processing' });
    sources.findOne.mockResolvedValue(doc);
    await expect(service.publish(ORG_ID, USER_ID, String(doc._id))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('publish() from pending_review sets published fields', async () => {
    const { service, sources } = makeService();
    const doc = makeHydratedSource({ status: 'pending_review' });
    sources.findOne.mockResolvedValue(doc);

    const result = await service.publish(ORG_ID, USER_ID, String(doc._id));

    expect(doc.status).toBe('published');
    expect((doc.publishedBy as Types.ObjectId).toString()).toBe(USER_ID);
    expect(doc.publishedAt).toBeInstanceOf(Date);
    expect(result.status).toBe('published');
  });

  it('archive() rejects a source still processing', async () => {
    const { service, sources } = makeService();
    const doc = makeHydratedSource({ status: 'processing' });
    sources.findOne.mockResolvedValue(doc);
    await expect(service.archive(ORG_ID, USER_ID, String(doc._id))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('archive() rejects a source that is already archived', async () => {
    const { service, sources } = makeService();
    const doc = makeHydratedSource({ status: 'archived' });
    sources.findOne.mockResolvedValue(doc);
    await expect(service.archive(ORG_ID, USER_ID, String(doc._id))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('archive() from published sets archived fields — this is a soft archive, never a hard delete', async () => {
    const { service, sources } = makeService();
    const doc = makeHydratedSource({ status: 'published' });
    sources.findOne.mockResolvedValue(doc);

    const result = await service.archive(ORG_ID, USER_ID, String(doc._id));

    expect(doc.status).toBe('archived');
    expect((doc.archivedBy as Types.ObjectId).toString()).toBe(USER_ID);
    expect(result.status).toBe('archived');
  });

  it('reprocess() only runs from failed, and clears out prior chunks for an idempotent retry', async () => {
    const { service, sources, chunks } = makeService();
    const doc = makeHydratedSource({ status: 'failed' });
    sources.findOne.mockResolvedValue(doc);
    sources.findById.mockReturnValue(leanChain(makeHydratedSource({ status: 'pending_review' })));
    jest
      .spyOn(service as unknown as { processSource: ProcessSourceFn }, 'processSource')
      .mockResolvedValue(undefined);

    await service.reprocess(ORG_ID, USER_ID, String(doc._id));

    expect(chunks.deleteMany).toHaveBeenCalledWith({
      orgId: doc.orgId,
      sourceId: doc._id,
      sourceVersion: doc.version,
    });
  });

  it('reprocess() rejects a source that is not failed', async () => {
    const { service, sources } = makeService();
    const doc = makeHydratedSource({ status: 'published' });
    sources.findOne.mockResolvedValue(doc);
    await expect(service.reprocess(ORG_ID, USER_ID, String(doc._id))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('KnowledgeService.delete', () => {
  function mockBucketDelete(service: KnowledgeService, impl: jest.Mock = jest.fn().mockResolvedValue(undefined)) {
    jest.spyOn(service as unknown as { bucket: BucketGetter }, 'bucket', 'get').mockReturnValue({ delete: impl });
    return impl;
  }

  it('rejects without confirm: true, and never touches the source at all', async () => {
    const { service, sources } = makeService();
    await expect(
      service.delete(ORG_ID, USER_ID, 'anything', { confirm: false as unknown as true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sources.findOne).not.toHaveBeenCalled();
  });

  it('rejects deleting a live published source — it must be archived first', async () => {
    const { service, sources } = makeService();
    const doc = makeHydratedSource({ status: 'published' });
    sources.findOne.mockResolvedValue(doc);
    await expect(service.delete(ORG_ID, USER_ID, String(doc._id), { confirm: true })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(doc.status).toBe('published'); // untouched
  });

  it('rejects deleting a source still processing or pending review', async () => {
    const { service, sources } = makeService();
    for (const status of ['processing', 'pending_review'] as const) {
      const doc = makeHydratedSource({ status });
      sources.findOne.mockResolvedValue(doc);
      await expect(service.delete(ORG_ID, USER_ID, String(doc._id), { confirm: true })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
  });

  it('allows deletion from archived, superseded, or failed status', async () => {
    for (const status of ['archived', 'superseded', 'failed'] as const) {
      const { service, sources, chunks } = makeService();
      const doc = makeHydratedSource({ status });
      sources.findOne.mockResolvedValue(doc);
      mockBucketDelete(service);

      const result = await service.delete(ORG_ID, USER_ID, String(doc._id), { confirm: true });

      expect(doc.status).toBe('deleted');
      expect(result.status).toBe('deleted');
      expect(chunks.deleteMany).toHaveBeenCalledWith({ orgId: doc.orgId, sourceId: doc._id });
    }
  });

  it('flips status to deleted and sets deletedBy/deletedAt', async () => {
    const { service, sources } = makeService();
    const doc = makeHydratedSource({ status: 'archived' });
    sources.findOne.mockResolvedValue(doc);
    mockBucketDelete(service);

    await service.delete(ORG_ID, USER_ID, String(doc._id), { confirm: true });

    expect(doc.status).toBe('deleted');
    expect((doc.deletedBy as Types.ObjectId).toString()).toBe(USER_ID);
    expect(doc.deletedAt).toBeInstanceOf(Date);
  });

  it('removes chunks for every version of the source, not just the current one', async () => {
    const { service, sources, chunks } = makeService();
    const doc = makeHydratedSource({ status: 'archived', version: 3 });
    sources.findOne.mockResolvedValue(doc);
    mockBucketDelete(service);

    await service.delete(ORG_ID, USER_ID, String(doc._id), { confirm: true });

    const query = chunks.deleteMany.mock.calls[0][0];
    expect(query).toEqual({ orgId: doc.orgId, sourceId: doc._id }); // no sourceVersion filter
  });

  it('deletes the underlying GridFS file', async () => {
    const { service, sources } = makeService();
    const doc = makeHydratedSource({ status: 'archived' });
    sources.findOne.mockResolvedValue(doc);
    const deleteMock = mockBucketDelete(service);

    await service.delete(ORG_ID, USER_ID, String(doc._id), { confirm: true });

    expect(deleteMock).toHaveBeenCalledWith(doc.gridFsFileId);
  });

  it('is idempotent: calling delete() again on an already-deleted source succeeds and retries cleanup rather than erroring', async () => {
    const { service, sources, chunks } = makeService();
    const doc = makeHydratedSource({ status: 'deleted', deletedAt: new Date('2026-01-01') });
    sources.findOne.mockResolvedValue(doc);
    // Simulates a GridFS file already gone from a prior attempt — caught and ignored, not rethrown.
    const deleteMock = mockBucketDelete(service, jest.fn().mockRejectedValue(new Error('FileNotFound')));

    const result = await service.delete(ORG_ID, USER_ID, String(doc._id), { confirm: true });

    expect(result.status).toBe('deleted');
    expect(chunks.deleteMany).toHaveBeenCalled(); // retried, not skipped
    expect(deleteMock).toHaveBeenCalled();
    expect(doc.deletedAt).toEqual(new Date('2026-01-01')); // original timestamp preserved, not overwritten
  });

  it('never records a second deleted audit event when retried on an already-deleted source', async () => {
    const { service, sources, auditEvents } = makeService();
    const doc = makeHydratedSource({ status: 'deleted' });
    sources.findOne.mockResolvedValue(doc);
    mockBucketDelete(service);

    await service.delete(ORG_ID, USER_ID, String(doc._id), { confirm: true });

    expect(auditEvents.create.mock.calls.filter((c) => c[0].action === 'deleted')).toHaveLength(0);
  });

  it('records a deleted audit event on the first successful deletion', async () => {
    const { service, sources, auditEvents } = makeService();
    const doc = makeHydratedSource({ status: 'archived' });
    sources.findOne.mockResolvedValue(doc);
    mockBucketDelete(service);

    await service.delete(ORG_ID, USER_ID, String(doc._id), { confirm: true });

    expect(auditEvents.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted' }));
  });

  it('never deletes a source belonging to a different org — scoped lookup, not by id alone', async () => {
    const { service, sources } = makeService();
    sources.findOne.mockResolvedValue(null); // simulates cross-org id: findOwnedOrThrow's own-org query finds nothing
    await expect(service.delete(ORG_ID, USER_ID, 'any-id', { confirm: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('KnowledgeService.list', () => {
  it('always scopes by orgId and applies optional status/surface filters', async () => {
    const { service, sources } = makeService();
    sources.find.mockReturnValue(sortLeanChain([]));

    await service.list(ORG_ID, { status: 'published', surface: 'assistant' });

    const query = sources.find.mock.calls[0][0];
    expect(query.orgId.toString()).toBe(ORG_ID);
    expect(query.status).toBe('published');
    expect(query.surfaces).toBe('assistant');
  });

  it('omits the reviewDueAt filter by default — reviewOverdue is opt-in', async () => {
    const { service, sources } = makeService();
    sources.find.mockReturnValue(sortLeanChain([]));
    await service.list(ORG_ID, {});
    expect(sources.find.mock.calls[0][0].reviewDueAt).toBeUndefined();
  });

  it('reviewOverdue:true filters to sources with a reviewDueAt in the past (never enforced at retrieval — visibility only)', async () => {
    const { service, sources } = makeService();
    sources.find.mockReturnValue(sortLeanChain([]));

    await service.list(ORG_ID, { reviewOverdue: true });

    const query = sources.find.mock.calls[0][0].reviewDueAt as { $ne: null; $lte: Date };
    expect(query.$ne).toBeNull();
    expect(query.$lte).toBeInstanceOf(Date);
    expect(query.$lte.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe('KnowledgeService — owner/role metadata validation (never trusts a client-supplied id as-is)', () => {
  it('upload() rejects an ownerUserId that does not resolve to a user in this org', async () => {
    const { service, sources, users } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    users.exists.mockResolvedValue(null);

    await expect(
      service.upload(ORG_ID, USER_ID, makeFile(), { ownerUserId: new Types.ObjectId().toString() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upload() rejects an accessRoleIds entry that does not resolve to a role in this org', async () => {
    const { service, sources, roles } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    roles.countDocuments.mockResolvedValue(0); // neither id actually belongs to this org

    await expect(
      service.upload(ORG_ID, USER_ID, makeFile(), {
        accessRoleIds: [new Types.ObjectId().toString(), new Types.ObjectId().toString()],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upload() accepts a valid ownerUserId/accessRoleIds and persists them on the created source', async () => {
    const { service, sources } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    jest.spyOn(service as unknown as { writeToGridFs: WriteToGridFsFn }, 'writeToGridFs')
      .mockResolvedValue(new Types.ObjectId());
    jest.spyOn(service as unknown as { processSource: ProcessSourceFn }, 'processSource')
      .mockResolvedValue(undefined);
    sources.create.mockResolvedValue(makeHydratedSource());
    sources.findById.mockReturnValue(leanChain(makeHydratedSource()));

    const ownerId = new Types.ObjectId().toString();
    const roleId = new Types.ObjectId().toString();
    await service.upload(ORG_ID, USER_ID, makeFile(), {
      ownerUserId: ownerId,
      accessRoleIds: [roleId],
      category: 'hr_people',
    });

    const createArgs = sources.create.mock.calls[0][0];
    expect(createArgs.ownerUserId.toString()).toBe(ownerId);
    expect(createArgs.accessRoleIds.map(String)).toEqual([roleId]);
    expect(createArgs.category).toBe('hr_people');
  });

  it('upload() rejects expiresAt at or before effectiveAt', async () => {
    const { service, sources } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));

    await expect(
      service.upload(ORG_ID, USER_ID, makeFile(), {
        effectiveAt: '2026-06-01T00:00:00.000Z',
        expiresAt: '2026-01-01T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updateMetadata() re-validates ownerUserId/accessRoleIds against this org, not just accepts them', async () => {
    const { service, sources, users } = makeService();
    const doc = makeHydratedSource();
    sources.findOneAndUpdate.mockReturnValue(leanChain(doc));
    users.exists.mockResolvedValue(null);

    await expect(
      service.updateMetadata(ORG_ID, USER_ID, String(doc._id), {
        ownerUserId: new Types.ObjectId().toString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('KnowledgeService.supersede', () => {
  it('marks the old source superseded and points both sources at each other', async () => {
    const { service, sources } = makeService();
    const oldDoc = makeHydratedSource({ status: 'published' });
    const newDoc = makeHydratedSource({ status: 'published' });
    sources.findOne.mockResolvedValueOnce(oldDoc).mockResolvedValueOnce(newDoc);

    const result = await service.supersede(ORG_ID, USER_ID, String(oldDoc._id), {
      supersededBySourceId: String(newDoc._id),
    });

    expect(oldDoc.status).toBe('superseded');
    expect((oldDoc.supersededBySourceId as Types.ObjectId).toString()).toBe(String(newDoc._id));
    expect((oldDoc.supersededBy as Types.ObjectId).toString()).toBe(USER_ID);
    expect(oldDoc.supersededAt).toBeInstanceOf(Date);
    expect((newDoc.supersedesSourceId as Types.ObjectId).toString()).toBe(String(oldDoc._id));
    expect(result.status).toBe('superseded');
  });

  it('rejects superseding a source that is not published', async () => {
    const { service, sources } = makeService();
    const oldDoc = makeHydratedSource({ status: 'pending_review' });
    const newDoc = makeHydratedSource({ status: 'published' });
    sources.findOne.mockResolvedValueOnce(oldDoc).mockResolvedValueOnce(newDoc);

    await expect(
      service.supersede(ORG_ID, USER_ID, String(oldDoc._id), { supersededBySourceId: String(newDoc._id) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a replacement that is not itself already published', async () => {
    const { service, sources } = makeService();
    const oldDoc = makeHydratedSource({ status: 'published' });
    const newDoc = makeHydratedSource({ status: 'pending_review' });
    sources.findOne.mockResolvedValueOnce(oldDoc).mockResolvedValueOnce(newDoc);

    await expect(
      service.supersede(ORG_ID, USER_ID, String(oldDoc._id), { supersededBySourceId: String(newDoc._id) }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a source superseding itself', async () => {
    const { service } = makeService();
    const id = new Types.ObjectId().toString();
    await expect(
      service.supersede(ORG_ID, USER_ID, id, { supersededBySourceId: id }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only resolves both the old and new source within the caller\'s own org — cross-org supersession is impossible', async () => {
    const { service, sources } = makeService();
    sources.findOne.mockResolvedValue(null); // simulates "not found in this org"
    await expect(
      service.supersede(ORG_ID, USER_ID, new Types.ObjectId().toString(), {
        supersededBySourceId: new Types.ObjectId().toString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // Both lookups were scoped by this exact org, not by id alone.
    for (const call of sources.findOne.mock.calls) {
      expect(call[0].orgId.toString()).toBe(ORG_ID);
    }
  });
});

describe('KnowledgeService — audit trail never carries sensitive content', () => {
  it('records an "uploaded" event on a successful upload, and a "duplicate_upload" event on a repeat', async () => {
    const { service, sources, auditEvents } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    jest.spyOn(service as unknown as { writeToGridFs: WriteToGridFsFn }, 'writeToGridFs')
      .mockResolvedValue(new Types.ObjectId());
    jest.spyOn(service as unknown as { processSource: ProcessSourceFn }, 'processSource')
      .mockResolvedValue(undefined);
    const created = makeHydratedSource();
    sources.create.mockResolvedValue(created);
    sources.findById.mockReturnValue(leanChain(created));

    await service.upload(ORG_ID, USER_ID, makeFile(), {});

    expect(auditEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'uploaded', sourceId: created._id }),
    );
  });

  it('records a "duplicate_upload" event (not "uploaded") when the bytes already exist, and never creates a new source', async () => {
    const existing = makeHydratedSource().toObject();
    const { service, sources, auditEvents } = makeService();
    sources.findOne.mockReturnValue(leanChain(existing));

    await service.upload(ORG_ID, USER_ID, makeFile(), {});

    expect(auditEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'duplicate_upload', sourceId: existing._id }),
    );
    expect(sources.create).not.toHaveBeenCalled();
  });

  it('a processing-failure audit event never contains the raw error message or file content', async () => {
    const sensitive = 'CONFIDENTIAL: employee SSN 123-45-6789';
    const { service, auditEvents } = makeService();
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockRejectedValue(new Error(sensitive));
    const doc = makeHydratedSource({ status: 'processing' });

    await (service as unknown as { processSource: ProcessSourceFn }).processSource(doc);

    const auditCall = auditEvents.create.mock.calls.find((c) => c[0].action === 'processing_failed');
    expect(auditCall).toBeDefined();
    expect(auditCall![0].outcome).not.toContain(sensitive);
  });

  it('a metadata_updated audit event records only field names, never the new values', async () => {
    const { service, sources, auditEvents } = makeService();
    const doc = makeHydratedSource();
    sources.findOneAndUpdate.mockReturnValue(leanChain(doc));

    await service.updateMetadata(ORG_ID, USER_ID, String(doc._id), {
      title: 'Confidential strategy document title',
    });

    const auditCall = auditEvents.create.mock.calls.find((c) => c[0].action === 'metadata_updated');
    expect(auditCall).toBeDefined();
    expect(JSON.stringify(auditCall![0].metadata)).not.toContain('Confidential strategy document title');
    expect(auditCall![0].metadata).toEqual({ fields: 'title' });
  });

  it('an audit write failure never blocks the operation it was recording (best-effort only)', async () => {
    const { service, sources, auditEvents } = makeService({
      auditOverrides: { create: jest.fn().mockRejectedValue(new Error('audit db down')) },
    });
    const doc = makeHydratedSource({ status: 'pending_review' });
    sources.findOne.mockResolvedValue(doc);

    const result = await service.publish(ORG_ID, USER_ID, String(doc._id));
    expect(result.status).toBe('published');
  });

  it('getAuditLog() only returns events for a source that belongs to this org', async () => {
    const { service, sources, auditEvents } = makeService();
    const doc = makeHydratedSource();
    sources.findOne.mockResolvedValue(doc);
    auditEvents.find.mockReturnValue(sortLeanChain([]));

    await service.getAuditLog(ORG_ID, String(doc._id));

    const query = auditEvents.find.mock.calls[0][0];
    expect(query.orgId).toBe(doc.orgId);
    expect(query.sourceId).toBe(doc._id);
  });
});

describe('KnowledgeService — reprocessing can never silently publish', () => {
  it('reprocess() can only ever leave a source pending_review or failed, never published', async () => {
    const { service, sources, chunks } = makeService();
    const doc = makeHydratedSource({ status: 'failed' });
    sources.findOne.mockResolvedValue(doc);
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockResolvedValue(Buffer.from('Some real extractable content here.'));
    sources.findById.mockReturnValue(leanChain(doc));

    await service.reprocess(ORG_ID, USER_ID, String(doc._id));

    expect(doc.status).not.toBe('published');
    expect(['pending_review', 'failed']).toContain(doc.status);
  });
});

describe('KnowledgeService — duplicate vs. changed-content uploads', () => {
  it('an upload with different bytes always creates a distinct new source, never merged with an unrelated existing one', async () => {
    const { service, sources } = makeService();
    sources.findOne.mockReturnValue(leanChain(null)); // no existing source shares this contentHash
    jest.spyOn(service as unknown as { writeToGridFs: WriteToGridFsFn }, 'writeToGridFs')
      .mockResolvedValue(new Types.ObjectId());
    jest.spyOn(service as unknown as { processSource: ProcessSourceFn }, 'processSource')
      .mockResolvedValue(undefined);
    sources.create.mockResolvedValue(makeHydratedSource());
    sources.findById.mockReturnValue(leanChain(makeHydratedSource()));

    const result = await service.upload(ORG_ID, USER_ID, makeFile({ buffer: Buffer.from('different content') }), {});

    expect(result.duplicate).toBe(false);
    expect(sources.create).toHaveBeenCalled();
  });
});

describe('KnowledgeService — PDF/DOCX ingestion (Phase 4A)', () => {
  // Locally generated fixtures — no external downloads, no binary files
  // committed to the repo. Verified against the real unpdf/mammoth
  // libraries in knowledge-document-extraction.util.spec.ts; reused here
  // in trimmed form just to exercise the full upload -> processSource
  // pipeline end to end.
  function buildMinimalPdf(pageTexts: string[]): Buffer {
    const parts: Buffer[] = [];
    const offsets: Record<number, number> = {};
    let length = 0;
    const push = (str: string) => {
      const buf = Buffer.from(str, 'latin1');
      parts.push(buf);
      length += buf.length;
    };
    const pushObj = (num: number, body: string) => {
      offsets[num] = length;
      push(`${num} 0 obj\n${body}\nendobj\n`);
    };
    push('%PDF-1.4\n');
    const n = pageTexts.length;
    const catalogNum = 1;
    const pagesNum = 2;
    let nextNum = 3;
    const fontNum = nextNum++;
    const pageNums: number[] = [];
    const contentNums: number[] = [];
    for (let i = 0; i < n; i++) {
      pageNums.push(nextNum++);
      contentNums.push(nextNum++);
    }
    pushObj(catalogNum, `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`);
    pushObj(pagesNum, `<< /Type /Pages /Kids [${pageNums.map((p) => `${p} 0 R`).join(' ')}] /Count ${n} >>`);
    pushObj(fontNum, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);
    for (let i = 0; i < n; i++) {
      const content = `BT /F1 24 Tf 72 712 Td (${pageTexts[i]}) Tj ET`;
      pushObj(
        pageNums[i],
        `<< /Type /Page /Parent ${pagesNum} 0 R /Resources << /Font << /F1 ${fontNum} 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentNums[i]} 0 R >>`,
      );
      pushObj(contentNums[i], `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    }
    const totalObjs = nextNum - 1;
    const xrefOffset = length;
    let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= totalObjs; i++) xref += String(offsets[i] ?? 0).padStart(10, '0') + ' 00000 n \n';
    push(xref);
    push(`trailer\n<< /Size ${totalObjs + 1} /Root ${catalogNum} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
    return Buffer.concat(parts);
  }

  function buildMinimalDocx(): Buffer {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const zlib = require('zlib');
    const files = [
      {
        name: '[Content_Types].xml',
        content: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
        ),
      },
      {
        name: '_rels/.rels',
        content: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
        ),
      },
      {
        name: 'word/document.xml',
        content: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Sample Heading</w:t></w:r></w:p><w:p><w:r><w:t>Sample DOCX paragraph content.</w:t></w:r></w:p></w:body></w:document>`,
        ),
      },
    ];
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;
    for (const f of files) {
      const nameBuf = Buffer.from(f.name, 'utf-8');
      const crc = zlib.crc32(f.content) >>> 0;
      const size = f.content.length;
      const localHeader = Buffer.alloc(30);
      localHeader.writeUInt32LE(0x04034b50, 0);
      localHeader.writeUInt16LE(20, 4);
      localHeader.writeUInt16LE(0, 6);
      localHeader.writeUInt16LE(0, 8);
      localHeader.writeUInt16LE(0, 10);
      localHeader.writeUInt16LE(0, 12);
      localHeader.writeUInt32LE(crc, 14);
      localHeader.writeUInt32LE(size, 18);
      localHeader.writeUInt32LE(size, 22);
      localHeader.writeUInt16LE(nameBuf.length, 26);
      localHeader.writeUInt16LE(0, 28);
      const localEntry = Buffer.concat([localHeader, nameBuf, f.content]);
      const localOffset = offset;
      localParts.push(localEntry);
      offset += localEntry.length;
      const centralHeader = Buffer.alloc(46);
      centralHeader.writeUInt32LE(0x02014b50, 0);
      centralHeader.writeUInt16LE(20, 4);
      centralHeader.writeUInt16LE(20, 6);
      centralHeader.writeUInt16LE(0, 8);
      centralHeader.writeUInt16LE(0, 10);
      centralHeader.writeUInt16LE(0, 12);
      centralHeader.writeUInt16LE(0, 14);
      centralHeader.writeUInt32LE(crc, 16);
      centralHeader.writeUInt32LE(size, 20);
      centralHeader.writeUInt32LE(size, 24);
      centralHeader.writeUInt16LE(nameBuf.length, 28);
      centralHeader.writeUInt16LE(0, 30);
      centralHeader.writeUInt16LE(0, 32);
      centralHeader.writeUInt16LE(0, 34);
      centralHeader.writeUInt16LE(0, 36);
      centralHeader.writeUInt32LE(0, 38);
      centralHeader.writeUInt32LE(localOffset, 42);
      centralParts.push(Buffer.concat([centralHeader, nameBuf]));
    }
    const localSection = Buffer.concat(localParts);
    const centralSection = Buffer.concat(centralParts);
    const centralDirOffset = localSection.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralSection.length, 12);
    eocd.writeUInt32LE(centralDirOffset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat([localSection, centralSection, eocd]);
  }

  const PDF_MIME = 'application/pdf';
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  it('accepts a PDF upload by default, extracts per-page chunks with real page numbers, and never auto-publishes', async () => {
    const pdfBuffer = buildMinimalPdf(['First page text', 'Second page text']);
    const { service, sources, chunks } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    jest
      .spyOn(service as unknown as { writeToGridFs: WriteToGridFsFn }, 'writeToGridFs')
      .mockResolvedValue(new Types.ObjectId());
    const created = makeHydratedSource({ mimeType: PDF_MIME, status: 'processing' });
    sources.create.mockResolvedValue(created);
    sources.findById.mockReturnValue(leanChain(created));
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockResolvedValue(pdfBuffer);

    const result = await service.upload(
      ORG_ID,
      USER_ID,
      makeFile({ mimetype: PDF_MIME, buffer: pdfBuffer, size: pdfBuffer.length }),
      {},
    );

    expect(result.duplicate).toBe(false);
    expect(created.status).toBe('pending_review'); // never 'published'
    const inserted = chunks.insertMany.mock.calls[0][0] as { page: number | null; text: string }[];
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({ page: 1 });
    expect(inserted[0].text).toContain('First page text');
    expect(inserted[1]).toMatchObject({ page: 2 });
  });

  it('accepts a DOCX upload by default, extracts section/heading provenance, and never auto-publishes', async () => {
    const docxBuffer = buildMinimalDocx();
    const { service, sources, chunks } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    jest
      .spyOn(service as unknown as { writeToGridFs: WriteToGridFsFn }, 'writeToGridFs')
      .mockResolvedValue(new Types.ObjectId());
    const created = makeHydratedSource({ mimeType: DOCX_MIME, status: 'processing' });
    sources.create.mockResolvedValue(created);
    sources.findById.mockReturnValue(leanChain(created));
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockResolvedValue(docxBuffer);

    await service.upload(
      ORG_ID,
      USER_ID,
      makeFile({ mimetype: DOCX_MIME, buffer: docxBuffer, size: docxBuffer.length }),
      {},
    );

    expect(created.status).toBe('pending_review');
    const inserted = chunks.insertMany.mock.calls[0][0] as { page: number | null; section: string | null }[];
    expect(inserted[0].section).toBe('Sample Heading');
    expect(inserted.every((c) => c.page === null)).toBe(true); // DOCX never invents a page number
  });

  it('rejects a PDF upload whose bytes do not match the PDF magic signature, before any GridFS write', async () => {
    const { service, sources } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    const writeSpy = jest.spyOn(
      service as unknown as { writeToGridFs: WriteToGridFsFn },
      'writeToGridFs',
    );

    await expect(
      service.upload(
        ORG_ID,
        USER_ID,
        makeFile({ mimetype: PDF_MIME, buffer: Buffer.from('not actually a pdf'), size: 20 }),
        {},
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('rejects a DOCX upload whose bytes do not match the ZIP magic signature, before any GridFS write', async () => {
    const { service, sources } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    const writeSpy = jest.spyOn(
      service as unknown as { writeToGridFs: WriteToGridFsFn },
      'writeToGridFs',
    );

    await expect(
      service.upload(
        ORG_ID,
        USER_ID,
        makeFile({ mimetype: DOCX_MIME, buffer: Buffer.from('not actually a docx'), size: 20 }),
        {},
      ),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('a PDF that fails extraction (too many pages) lands in "failed" with no chunks ever inserted — no partial, searchable index', async () => {
    const manyPagePdf = buildMinimalPdf(Array.from({ length: 400 }, (_, i) => `Page ${i}`));
    const { service, chunks } = makeService();
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockResolvedValue(manyPagePdf);
    const doc = makeHydratedSource({ mimeType: PDF_MIME, status: 'processing' });

    await (service as unknown as { processSource: (d: unknown) => Promise<void> }).processSource(doc);

    expect(doc.status).toBe('failed');
    expect(chunks.insertMany).not.toHaveBeenCalled();
  });

  it('regression: a plain .txt upload is completely unaffected by the new PDF/DOCX dispatch — same chunking, page always null', async () => {
    const { service, chunks } = makeService();
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockResolvedValue(Buffer.from('Paragraph one.\n\nParagraph two.'));
    const doc = makeHydratedSource({ mimeType: 'text/plain', status: 'processing' });

    await (service as unknown as { processSource: (d: unknown) => Promise<void> }).processSource(doc);

    expect(doc.status).toBe('pending_review');
    const inserted = chunks.insertMany.mock.calls[0][0] as { page: number | null }[];
    expect(inserted.every((c) => c.page === null)).toBe(true);
  });

  it('the default allowlist now includes PDF and DOCX — rejection is for bad content, never "unsupported file type"', async () => {
    const { service, sources } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    for (const mime of [PDF_MIME, DOCX_MIME]) {
      try {
        await service.upload(ORG_ID, USER_ID, makeFile({ mimetype: mime, buffer: Buffer.from('bad bytes') }), {});
        throw new Error('expected upload to reject');
      } catch (err) {
        expect(err).toBeInstanceOf(UnsupportedMediaTypeException);
        expect((err as Error).message).not.toMatch(/unsupported file type/i);
        expect((err as Error).message).toMatch(/does not look like a valid/i);
      }
    }
  });
});

describe('KnowledgeService.ingestApprovedWebPage (Phase 4B)', () => {
  afterEach(() => {
    fetchApprovedWebPageMock.mockReset();
  });

  it('never calls fetchApprovedWebPage\'s network layer for a URL this org has not approved — the approval check happens inside fetchApprovedWebPage itself, called with our isUrlApproved callback', async () => {
    const { service, webApprovals, sources, auditEvents } = makeService({
      webApprovalsOverrides: { isUrlApproved: jest.fn().mockResolvedValue(false) },
    });
    fetchApprovedWebPageMock.mockImplementation(async (_url: string, isApproved: (u: URL) => Promise<boolean>) => {
      // Faithful to the real function's own first step: check approval before any network call.
      const approved = await isApproved(new URL(_url));
      if (!approved) throw new WebFetchError('not_approved', "This URL is not on the organization's approved list.");
      throw new Error('should not reach here');
    });

    await expect(
      service.ingestApprovedWebPage(ORG_ID, USER_ID, { url: 'https://example.com/page' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(webApprovals.isUrlApproved).toHaveBeenCalledWith(ORG_ID, expect.anything());
    expect(sources.create).not.toHaveBeenCalled();
    const auditCall = auditEvents.create.mock.calls.find((c) => c[0].action === 'web_ingest_blocked');
    expect(auditCall).toBeDefined();
    expect(auditCall![0].sourceId).toBeNull();
  });

  it('a blocked-ingest audit event never contains the full query string of the attempted URL', async () => {
    const { service, auditEvents } = makeService();
    fetchApprovedWebPageMock.mockRejectedValue(
      new WebFetchError('forbidden_destination', 'this.host resolves to a non-public address and cannot be fetched.'),
    );

    await expect(
      service.ingestApprovedWebPage(ORG_ID, USER_ID, {
        url: 'https://example.com/page?token=super-secret-value',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const auditCall = auditEvents.create.mock.calls.find((c) => c[0].action === 'web_ingest_blocked');
    expect(JSON.stringify(auditCall![0].metadata)).not.toContain('super-secret-value');
  });

  it('successfully ingests a fetched page, lands in pending_review (never published), and records a provenance audit event', async () => {
    const html = '<html><body><h1>Title</h1><p>Some real content here.</p></body></html>';
    fetchApprovedWebPageMock.mockResolvedValue({
      html: Buffer.from(html),
      finalUrl: 'https://example.com/final-page',
    });
    const { service, sources, chunks, auditEvents } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    jest
      .spyOn(service as unknown as { writeToGridFs: WriteToGridFsFn }, 'writeToGridFs')
      .mockResolvedValue(new Types.ObjectId());
    const created = makeHydratedSource({ mimeType: 'text/html', status: 'processing' });
    sources.create.mockResolvedValue(created);
    sources.findById.mockReturnValue(leanChain(created));
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockResolvedValue(Buffer.from(html));

    const result = await service.ingestApprovedWebPage(ORG_ID, USER_ID, { url: 'https://example.com/start' });

    expect(result.duplicate).toBe(false);
    expect(created.status).toBe('pending_review'); // never 'published'
    expect(chunks.insertMany).toHaveBeenCalled();
    const inserted = chunks.insertMany.mock.calls[0][0] as { section: string | null; page: number | null }[];
    expect(inserted[0].section).toBe('Title');
    expect(inserted.every((c) => c.page === null)).toBe(true);
    expect(auditEvents.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'uploaded' }));
  });

  it('deduplicates a re-ingest of byte-identical content against an existing source, never creating a second copy', async () => {
    const html = '<html><body><p>Same content.</p></body></html>';
    fetchApprovedWebPageMock.mockResolvedValue({ html: Buffer.from(html), finalUrl: 'https://example.com/page' });
    const existing = makeHydratedSource({ mimeType: 'text/html' }).toObject();
    const { service, sources } = makeService();
    sources.findOne.mockReturnValue(leanChain(existing));

    const result = await service.ingestApprovedWebPage(ORG_ID, USER_ID, { url: 'https://example.com/page' });

    expect(result.duplicate).toBe(true);
    expect(sources.create).not.toHaveBeenCalled();
  });

  it('a fetch/extraction failure never leaves partially indexed, searchable chunks', async () => {
    fetchApprovedWebPageMock.mockResolvedValue({
      html: Buffer.from('<html><body><p>content</p></body></html>'),
      finalUrl: 'https://example.com/page',
    });
    const { service, sources, chunks } = makeService();
    sources.findOne.mockReturnValue(leanChain(null));
    jest
      .spyOn(service as unknown as { writeToGridFs: WriteToGridFsFn }, 'writeToGridFs')
      .mockResolvedValue(new Types.ObjectId());
    const created = makeHydratedSource({ mimeType: 'text/html', status: 'processing' });
    sources.create.mockResolvedValue(created);
    sources.findById.mockReturnValue(leanChain(created));
    jest
      .spyOn(service as unknown as { readFromGridFs: ReadFromGridFsFn }, 'readFromGridFs')
      .mockRejectedValue(new Error('simulated extraction crash'));

    await service.ingestApprovedWebPage(ORG_ID, USER_ID, { url: 'https://example.com/page' });

    expect(created.status).toBe('failed');
    expect(chunks.insertMany).not.toHaveBeenCalled();
  });
});
