import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { KnowledgeAuditEventDocument } from '../schemas/knowledge-audit-event.schema';
import { KnowledgeCollectionDocument } from '../schemas/knowledge-collection.schema';
import { KnowledgeSourceDocument } from '../schemas/knowledge-source.schema';
import { KnowledgeCollectionService } from './knowledge-collection.service';

function leanChain<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}
function sortLeanChain<T>(value: T) {
  return { sort: jest.fn().mockReturnValue(leanChain(value)) };
}

function makeHydratedCollection(overrides: Partial<Record<string, unknown>> = {}) {
  const base: Record<string, unknown> = {
    _id: new Types.ObjectId(),
    orgId: new Types.ObjectId(),
    key: 'hr_people',
    name: 'HR & People',
    description: null,
    status: 'active',
    createdBy: new Types.ObjectId(),
    archivedBy: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  const doc = { ...base, save: jest.fn().mockResolvedValue(undefined), toObject: jest.fn() } as Record<
    string,
    unknown
  > & { save: jest.Mock; toObject: jest.Mock };
  doc.toObject.mockImplementation(() => {
    const { save: _s, toObject: _t, ...plain } = doc;
    return plain;
  });
  return doc;
}

function makeService(opts: { collectionsOverrides?: Record<string, jest.Mock>; sourcesOverrides?: Record<string, jest.Mock> } = {}) {
  const collections = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    ...opts.collectionsOverrides,
  };
  const sources = {
    aggregate: jest.fn().mockResolvedValue([]),
    ...opts.sourcesOverrides,
  };
  const auditEvents = { create: jest.fn().mockResolvedValue({}) };
  const service = new KnowledgeCollectionService(
    collections as unknown as Model<KnowledgeCollectionDocument>,
    sources as unknown as Model<KnowledgeSourceDocument>,
    auditEvents as unknown as Model<KnowledgeAuditEventDocument>,
  );
  return { service, collections, sources, auditEvents };
}

const ORG_ID = new Types.ObjectId().toString();
const USER_ID = new Types.ObjectId().toString();

describe('KnowledgeCollectionService.create', () => {
  it('derives orgId/createdBy from trusted method parameters, never from the DTO', async () => {
    const { service, collections } = makeService();
    collections.create.mockResolvedValue(makeHydratedCollection());

    await service.create(ORG_ID, USER_ID, { key: 'hr_people' });

    const createArgs = collections.create.mock.calls[0][0];
    expect(createArgs.orgId.toString()).toBe(ORG_ID);
    expect(createArgs.createdBy.toString()).toBe(USER_ID);
  });

  it('defaults the display name to the canonical label when none is given', async () => {
    const { service, collections } = makeService();
    collections.create.mockResolvedValue(makeHydratedCollection());

    await service.create(ORG_ID, USER_ID, { key: 'it_security' });

    expect(collections.create.mock.calls[0][0].name).toBe('IT & Security');
  });

  it('rejects a duplicate (org, key) collection with a clear error, not a raw Mongo error', async () => {
    const { service, collections } = makeService();
    collections.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

    await expect(service.create(ORG_ID, USER_ID, { key: 'hr_people' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('records a collection_created audit event with no sourceId', async () => {
    const { service, collections, auditEvents } = makeService();
    collections.create.mockResolvedValue(makeHydratedCollection());

    await service.create(ORG_ID, USER_ID, { key: 'hr_people' });

    expect(auditEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'collection_created', sourceId: null }),
    );
  });
});

describe('KnowledgeCollectionService.list / getOne', () => {
  it('list always scopes by orgId and includes a computed sourceCount per collection', async () => {
    const { service, collections, sources } = makeService();
    const doc = makeHydratedCollection();
    collections.find.mockReturnValue(sortLeanChain([doc]));
    sources.aggregate.mockResolvedValue([{ _id: 'hr_people', count: 3 }]);

    const result = await service.list(ORG_ID);

    expect(collections.find.mock.calls[0][0].orgId.toString()).toBe(ORG_ID);
    expect(result[0].sourceCount).toBe(3);
  });

  it('getOne only finds a collection within this exact org, never by id alone', async () => {
    const { service, collections } = makeService();
    const doc = makeHydratedCollection();
    collections.findOne.mockResolvedValue(doc);

    await service.getOne(ORG_ID, String(doc._id));

    const query = collections.findOne.mock.calls[0][0];
    expect(query.orgId.toString()).toBe(ORG_ID);
    expect(query._id).toBe(String(doc._id));
  });

  it('throws NotFoundException for a collection that does not belong to this org', async () => {
    const { service, collections } = makeService();
    collections.findOne.mockResolvedValue(null);
    await expect(service.getOne(ORG_ID, 'anything')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('KnowledgeCollectionService.update', () => {
  it('updates only name/description, never the immutable key', async () => {
    const { service, collections } = makeService();
    const doc = makeHydratedCollection();
    collections.findOne.mockResolvedValue(doc);

    await service.update(ORG_ID, USER_ID, String(doc._id), { name: 'Renamed', description: 'new desc' });

    expect(doc.name).toBe('Renamed');
    expect(doc.description).toBe('new desc');
    expect(doc.key).toBe('hr_people'); // untouched — no key field in UpdateKnowledgeCollectionDto at all
  });

  it('records a collection_updated audit event listing only field names', async () => {
    const { service, collections, auditEvents } = makeService();
    const doc = makeHydratedCollection();
    collections.findOne.mockResolvedValue(doc);

    await service.update(ORG_ID, USER_ID, String(doc._id), { name: 'Confidential Secret Title' });

    const auditCall = auditEvents.create.mock.calls.find((c) => c[0].action === 'collection_updated');
    expect(auditCall).toBeDefined();
    expect(JSON.stringify(auditCall![0].metadata)).not.toContain('Confidential Secret Title');
    expect(auditCall![0].metadata).toEqual({ fields: 'name' });
  });
});

describe('KnowledgeCollectionService.archive', () => {
  it('rejects archiving an already-archived collection', async () => {
    const { service, collections } = makeService();
    collections.findOne.mockResolvedValue(makeHydratedCollection({ status: 'archived' }));
    await expect(service.archive(ORG_ID, USER_ID, 'anything')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('sets status/archivedBy/archivedAt and succeeds even when the collection still has sources', async () => {
    const { service, collections, sources } = makeService();
    const doc = makeHydratedCollection();
    collections.findOne.mockResolvedValue(doc);
    sources.aggregate.mockResolvedValue([{ _id: 'hr_people', count: 12 }]); // still has 12 sources

    const result = await service.archive(ORG_ID, USER_ID, String(doc._id));

    expect(doc.status).toBe('archived');
    expect((doc.archivedBy as Types.ObjectId).toString()).toBe(USER_ID);
    expect(doc.archivedAt).toBeInstanceOf(Date);
    expect(result.status).toBe('archived');
    expect(result.sourceCount).toBe(12); // informational only — archiving never touches the sources themselves
  });

  it('records a collection_archived audit event including the source count at archival time', async () => {
    const { service, collections, sources, auditEvents } = makeService();
    const doc = makeHydratedCollection();
    collections.findOne.mockResolvedValue(doc);
    sources.aggregate.mockResolvedValue([{ _id: 'hr_people', count: 5 }]);

    await service.archive(ORG_ID, USER_ID, String(doc._id));

    expect(auditEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'collection_archived',
        metadata: expect.objectContaining({ sourceCountAtArchival: 5 }),
      }),
    );
  });
});

describe('KnowledgeCollectionService.assertCategoryAssignable', () => {
  it('allows assignment when no collection record exists yet for this (org, key) — backward compatible with bare category tagging', async () => {
    const { service, collections } = makeService();
    collections.findOne.mockReturnValue(leanChain(null));
    await expect(service.assertCategoryAssignable(ORG_ID, 'hr_people')).resolves.toBeUndefined();
  });

  it('allows assignment when the collection record exists and is active', async () => {
    const { service, collections } = makeService();
    collections.findOne.mockReturnValue(leanChain({ status: 'active' }));
    await expect(service.assertCategoryAssignable(ORG_ID, 'hr_people')).resolves.toBeUndefined();
  });

  it('rejects assignment when the collection record exists and is archived', async () => {
    const { service, collections } = makeService();
    collections.findOne.mockReturnValue(leanChain({ status: 'archived' }));
    await expect(service.assertCategoryAssignable(ORG_ID, 'hr_people')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('always scopes the lookup by this exact org', async () => {
    const { service, collections } = makeService();
    collections.findOne.mockReturnValue(leanChain(null));
    await service.assertCategoryAssignable(ORG_ID, 'hr_people');
    expect(collections.findOne.mock.calls[0][0].orgId.toString()).toBe(ORG_ID);
  });
});
