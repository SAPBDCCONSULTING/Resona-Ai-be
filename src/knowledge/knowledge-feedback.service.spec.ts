import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { KnowledgeAuditEventDocument } from '../schemas/knowledge-audit-event.schema';
import { KnowledgeFeedbackDocument } from '../schemas/knowledge-feedback.schema';
import { KnowledgeSourceDocument } from '../schemas/knowledge-source.schema';
import { KnowledgeFeedbackService } from './knowledge-feedback.service';

function leanChain<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}
function sortLeanChain<T>(value: T) {
  return { sort: jest.fn().mockReturnValue(leanChain(value)) };
}

function makeHydratedFeedback(overrides: Partial<Record<string, unknown>> = {}) {
  const base: Record<string, unknown> = {
    _id: new Types.ObjectId(),
    orgId: new Types.ObjectId(),
    actorUserId: new Types.ObjectId(),
    rating: 'not_helpful',
    issueType: null,
    explanation: null,
    surface: null,
    answerRef: null,
    citationSourceId: null,
    citationSourceVersion: null,
    citationChunkId: null,
    status: 'open',
    ownerUserId: null,
    routed: false,
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
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

function makeService(
  opts: { feedbackOverrides?: Record<string, jest.Mock>; sourcesOverrides?: Record<string, jest.Mock> } = {},
) {
  const feedback = {
    create: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    ...opts.feedbackOverrides,
  };
  const sources = {
    findOne: jest.fn().mockReturnValue(leanChain(null)),
    ...opts.sourcesOverrides,
  };
  const auditEvents = { create: jest.fn().mockResolvedValue({}) };
  const service = new KnowledgeFeedbackService(
    feedback as unknown as Model<KnowledgeFeedbackDocument>,
    sources as unknown as Model<KnowledgeSourceDocument>,
    auditEvents as unknown as Model<KnowledgeAuditEventDocument>,
  );
  return { service, feedback, sources, auditEvents };
}

const ORG_ID = new Types.ObjectId().toString();
const OTHER_ORG_ID = new Types.ObjectId().toString();
const USER_ID = new Types.ObjectId().toString();
const OWNER_ID = new Types.ObjectId().toString();
const SOURCE_ID = new Types.ObjectId().toString();

describe('KnowledgeFeedbackService.submit', () => {
  it('rejects a submission with neither a rating nor an issue type', async () => {
    const { service } = makeService();
    await expect(service.submit(ORG_ID, USER_ID, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('derives orgId/actorUserId from trusted method parameters, never from the DTO', async () => {
    const { service, feedback } = makeService();
    feedback.create.mockResolvedValue(makeHydratedFeedback());

    await service.submit(ORG_ID, USER_ID, { rating: 'helpful' });

    const createArgs = feedback.create.mock.calls[0][0];
    expect(createArgs.orgId.toString()).toBe(ORG_ID);
    expect(createArgs.actorUserId.toString()).toBe(USER_ID);
  });

  it('rejects a citation referencing a source from a different organization', async () => {
    const { service, sources } = makeService({
      sourcesOverrides: { findOne: jest.fn().mockReturnValue(leanChain(null)) },
    });

    await expect(
      service.submit(OTHER_ORG_ID, USER_ID, { rating: 'helpful', citationSourceId: SOURCE_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(sources.findOne.mock.calls[0][0].orgId.toString()).toBe(OTHER_ORG_ID);
  });

  it('routes to the source owner and sets routed=true when the cited source has a configured owner', async () => {
    const { service, feedback, sources } = makeService({
      sourcesOverrides: {
        findOne: jest
          .fn()
          .mockReturnValue(leanChain({ _id: new Types.ObjectId(SOURCE_ID), version: 2, ownerUserId: new Types.ObjectId(OWNER_ID) })),
      },
    });
    feedback.create.mockResolvedValue(makeHydratedFeedback());

    await service.submit(ORG_ID, USER_ID, { rating: 'not_helpful', citationSourceId: SOURCE_ID });

    const createArgs = feedback.create.mock.calls[0][0];
    expect(createArgs.ownerUserId.toString()).toBe(OWNER_ID);
    expect(createArgs.routed).toBe(true);
    void sources;
  });

  it('never fabricates an owner: routed=false and ownerUserId=null when the cited source has no owner configured', async () => {
    const { service, feedback } = makeService({
      sourcesOverrides: {
        findOne: jest.fn().mockReturnValue(leanChain({ _id: new Types.ObjectId(SOURCE_ID), version: 1, ownerUserId: null })),
      },
    });
    feedback.create.mockResolvedValue(makeHydratedFeedback());

    await service.submit(ORG_ID, USER_ID, { rating: 'not_helpful', citationSourceId: SOURCE_ID });

    const createArgs = feedback.create.mock.calls[0][0];
    expect(createArgs.ownerUserId).toBeNull();
    expect(createArgs.routed).toBe(false);
  });

  it('never persists raw prompt/answer content — only structural fields reach the create() call', async () => {
    const { service, feedback } = makeService();
    feedback.create.mockResolvedValue(makeHydratedFeedback());

    await service.submit(ORG_ID, USER_ID, {
      rating: 'not_helpful',
      explanation: 'The policy section seemed outdated.',
    });

    const createArgs = feedback.create.mock.calls[0][0];
    expect(Object.keys(createArgs).sort()).toEqual(
      [
        'actorUserId',
        'answerRef',
        'citationChunkId',
        'citationSourceId',
        'citationSourceVersion',
        'explanation',
        'issueType',
        'orgId',
        'ownerUserId',
        'rating',
        'routed',
        'status',
        'surface',
      ].sort(),
    );
  });

  it('collapses a duplicate submission for the same (org, actor, answerRef) into an update instead of a new row', async () => {
    const existing = makeHydratedFeedback({ rating: 'helpful', answerRef: 'answer-123' });
    const { service, feedback } = makeService({
      feedbackOverrides: { findOne: jest.fn().mockResolvedValue(existing) },
    });

    await service.submit(ORG_ID, USER_ID, { rating: 'not_helpful', answerRef: 'answer-123' });

    expect(existing.save).toHaveBeenCalled();
    expect(existing.rating).toBe('not_helpful');
    expect(feedback.create).not.toHaveBeenCalled();
  });

  it('records a feedback_submitted audit event with no raw content in metadata', async () => {
    const { service, feedback, auditEvents } = makeService();
    feedback.create.mockResolvedValue(makeHydratedFeedback());

    await service.submit(ORG_ID, USER_ID, { rating: 'helpful', explanation: 'Secret detail' });

    const call = auditEvents.create.mock.calls.find((c) => c[0].action === 'feedback_submitted');
    expect(call).toBeDefined();
    expect(JSON.stringify(call![0].metadata)).not.toContain('Secret detail');
  });
});

describe('KnowledgeFeedbackService.list', () => {
  it('a manage-permission caller sees all org feedback regardless of owner', async () => {
    const { service, feedback } = makeService({
      feedbackOverrides: { find: jest.fn().mockReturnValue(sortLeanChain([makeHydratedFeedback()])) },
    });

    await service.list(ORG_ID, USER_ID, true);

    const query = feedback.find.mock.calls[0][0];
    expect(query.orgId.toString()).toBe(ORG_ID);
    expect(query.ownerUserId).toBeUndefined();
  });

  it('a non-manage caller only sees feedback explicitly routed to them', async () => {
    const { service, feedback } = makeService({
      feedbackOverrides: { find: jest.fn().mockReturnValue(sortLeanChain([])) },
    });

    await service.list(ORG_ID, USER_ID, false);

    const query = feedback.find.mock.calls[0][0];
    expect(query.ownerUserId.toString()).toBe(USER_ID);
  });
});

describe('KnowledgeFeedbackService.resolve', () => {
  it('throws NotFoundException for feedback outside this org', async () => {
    const { service, feedback } = makeService({ feedbackOverrides: { findOne: jest.fn().mockResolvedValue(null) } });
    await expect(
      service.resolve(ORG_ID, USER_ID, false, 'anything', { status: 'resolved' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects resolution by a caller who is neither the assigned owner nor a manager', async () => {
    const doc = makeHydratedFeedback({ ownerUserId: new Types.ObjectId(OWNER_ID) });
    const { service, feedback } = makeService({ feedbackOverrides: { findOne: jest.fn().mockResolvedValue(doc) } });

    await expect(
      service.resolve(ORG_ID, USER_ID, false, String(doc._id), { status: 'resolved' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows resolution by the assigned owner even without kb:feedback_manage', async () => {
    const doc = makeHydratedFeedback({ ownerUserId: new Types.ObjectId(USER_ID) });
    const { service, feedback } = makeService({ feedbackOverrides: { findOne: jest.fn().mockResolvedValue(doc) } });

    const result = await service.resolve(ORG_ID, USER_ID, false, String(doc._id), { status: 'resolved' });

    expect(result.status).toBe('resolved');
    expect(doc.resolvedBy?.toString()).toBe(USER_ID);
    expect(doc.resolvedAt).toBeInstanceOf(Date);
  });

  it('allows resolution by a kb:feedback_manage holder for an unowned fallback-queue item', async () => {
    const doc = makeHydratedFeedback({ ownerUserId: null });
    const { service, feedback } = makeService({ feedbackOverrides: { findOne: jest.fn().mockResolvedValue(doc) } });

    const result = await service.resolve(ORG_ID, USER_ID, true, String(doc._id), {
      status: 'dismissed',
      resolutionNote: 'Not actionable',
    });

    expect(result.status).toBe('dismissed');
    expect(doc.resolutionNote).toBe('Not actionable');
  });

  it('records a feedback_status_changed audit event capturing the from/to status', async () => {
    const doc = makeHydratedFeedback({ ownerUserId: new Types.ObjectId(USER_ID), status: 'open' });
    const { service, feedback, auditEvents } = makeService({
      feedbackOverrides: { findOne: jest.fn().mockResolvedValue(doc) },
    });

    await service.resolve(ORG_ID, USER_ID, false, String(doc._id), { status: 'reviewing' });

    expect(auditEvents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'feedback_status_changed',
        metadata: expect.objectContaining({ fromStatus: 'open', toStatus: 'reviewing' }),
      }),
    );
  });
});
