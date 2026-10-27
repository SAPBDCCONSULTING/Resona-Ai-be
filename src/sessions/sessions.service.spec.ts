import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { SessionDocument } from '../schemas/session.schema';
import { ContactsService } from '../contacts/contacts.service';
import { SessionsService } from './sessions.service';

/**
 * Focused on knowledgeCollectionIds (new field for the Describe Session
 * Knowledge Base scoping feature) — this module otherwise has no existing
 * test file, so this intentionally does not attempt broader coverage.
 */

function leanChain<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

type SessionModelMock = {
  create: jest.Mock;
  findOneAndUpdate: jest.Mock;
  findOne: jest.Mock;
};

function makeService(opts: { sessionOverrides?: Partial<SessionModelMock> } = {}) {
  const sessions: SessionModelMock = {
    create: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findOne: jest.fn(),
    ...opts.sessionOverrides,
  };
  const config = { get: jest.fn() } as unknown as ConfigService;
  const contactsService = {} as unknown as ContactsService;
  const service = new SessionsService(
    sessions as unknown as Model<SessionDocument>,
    config,
    contactsService,
  );
  return { service, sessions };
}

function makeSessionDoc(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    _id: new Types.ObjectId(),
    orgId: new Types.ObjectId(),
    title: 'Draft session',
    type: 'one_on_one',
    status: 'draft',
    startAt: null,
    endAt: null,
    createdBy: new Types.ObjectId(),
    createdByName: 'Tester',
    campaignId: null,
    progress: { invited: 0, completed: 0, percent: 0, health: 'no_schedule' },
    favorite: false,
    topics: [],
    goalPrompt: null,
    wizardStep: 'describe',
    entryMode: 'blank',
    tone: null,
    reportTemplateId: null,
    participantIds: [],
    assignedUserIds: [],
    participantTitle: null,
    participantDescription: null,
    welcomeMessage: null,
    anonymous: false,
    invitation: { subject: '', header: '', body: '' },
    engagementMetrics: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const ORG_ID = new Types.ObjectId().toString();

describe('SessionsService.createDraft', () => {
  it('defaults knowledgeCollectionIds to an empty array for a brand-new draft', async () => {
    const { service, sessions } = makeService();
    sessions.create.mockResolvedValue({ toObject: () => makeSessionDoc() });

    await service.createDraft(
      { userId: new Types.ObjectId().toString(), orgId: ORG_ID, name: 'Tester' },
      {},
    );

    expect(sessions.create.mock.calls[0][0].knowledgeCollectionIds).toEqual([]);
  });
});

describe('SessionsService.updateDraft — knowledgeCollectionIds', () => {
  it('persists a provided knowledgeCollectionIds selection via $set', async () => {
    const { service, sessions } = makeService();
    const collectionId = new Types.ObjectId().toString();
    sessions.findOneAndUpdate.mockReturnValue(
      leanChain(makeSessionDoc({ knowledgeCollectionIds: [collectionId] })),
    );

    await service.updateDraft(ORG_ID, 'session-id', { knowledgeCollectionIds: [collectionId] });

    const [, update] = sessions.findOneAndUpdate.mock.calls[0];
    expect((update as { $set: Record<string, unknown> }).$set.knowledgeCollectionIds).toEqual([
      collectionId,
    ]);
  });

  it('never touches knowledgeCollectionIds when the field is omitted from the PATCH — does not clobber an existing selection with other, unrelated field updates', async () => {
    const { service, sessions } = makeService();
    sessions.findOneAndUpdate.mockReturnValue(leanChain(makeSessionDoc()));

    await service.updateDraft(ORG_ID, 'session-id', { title: 'New title' });

    const [, update] = sessions.findOneAndUpdate.mock.calls[0];
    expect(
      Object.prototype.hasOwnProperty.call(
        (update as { $set: Record<string, unknown> }).$set,
        'knowledgeCollectionIds',
      ),
    ).toBe(false);
  });

  it('can clear a selection back to an empty array', async () => {
    const { service, sessions } = makeService();
    sessions.findOneAndUpdate.mockReturnValue(leanChain(makeSessionDoc({ knowledgeCollectionIds: [] })));

    await service.updateDraft(ORG_ID, 'session-id', { knowledgeCollectionIds: [] });

    const [, update] = sessions.findOneAndUpdate.mock.calls[0];
    expect((update as { $set: Record<string, unknown> }).$set.knowledgeCollectionIds).toEqual([]);
  });

  it('scopes the update to this exact org, not by session id alone', async () => {
    const { service, sessions } = makeService();
    sessions.findOneAndUpdate.mockReturnValue(leanChain(makeSessionDoc()));

    await service.updateDraft(ORG_ID, 'session-id', { knowledgeCollectionIds: [] });

    const [filter] = sessions.findOneAndUpdate.mock.calls[0];
    expect((filter as { orgId: Types.ObjectId }).orgId.toString()).toBe(ORG_ID);
  });
});

describe('SessionsService — toDto knowledgeCollectionIds (old-draft compatibility)', () => {
  it('returns an empty array when the underlying document predates this field entirely', async () => {
    const { service, sessions } = makeService();
    const legacyDoc = makeSessionDoc();
    delete legacyDoc.knowledgeCollectionIds; // simulates a draft created before this field existed
    sessions.findOne.mockReturnValue(leanChain(legacyDoc));

    const result = await service.getOne(ORG_ID, 'session-id');

    expect(result.knowledgeCollectionIds).toEqual([]);
  });

  it('round-trips a populated selection unchanged', async () => {
    const { service, sessions } = makeService();
    const ids = [new Types.ObjectId().toString(), new Types.ObjectId().toString()];
    sessions.findOne.mockReturnValue(leanChain(makeSessionDoc({ knowledgeCollectionIds: ids })));

    const result = await service.getOne(ORG_ID, 'session-id');

    expect(result.knowledgeCollectionIds).toEqual(ids);
  });
});
