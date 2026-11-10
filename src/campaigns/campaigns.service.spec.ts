import { Model, Types } from 'mongoose';
import { CampaignDocument, SessionDocument } from '../schemas/session.schema';
import { SessionTemplateDocument } from '../schemas/session-template.schema';
import { CampaignsService } from './campaigns.service';
import type { CreateCampaignDto } from './dto/campaign.dto';

const ORG_ID = new Types.ObjectId().toString();
const USER_ID = new Types.ObjectId().toString();
const ACTOR = { userId: USER_ID, orgId: ORG_ID, name: 'Tester' };

function leanChain<T>(value: T) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function sortLeanChain<T>(value: T) {
  return { sort: jest.fn().mockReturnValue(leanChain(value)) };
}

function makeService() {
  const campaignId = new Types.ObjectId();
  const campaigns = {
    create: jest.fn().mockResolvedValue({ _id: campaignId }),
    updateOne: jest.fn().mockResolvedValue({}),
    deleteOne: jest.fn().mockResolvedValue({}),
    findOne: jest.fn(),
  };
  const sessions = {
    insertMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({}),
    find: jest.fn(),
  };
  const templates = { findOne: jest.fn() };
  const service = new CampaignsService(
    campaigns as unknown as Model<CampaignDocument>,
    sessions as unknown as Model<SessionDocument>,
    templates as unknown as Model<SessionTemplateDocument>,
  );
  // Reads after create: rollup (lean) then getOne (campaign + sorted sessions).
  sessions.find.mockImplementation(() => ({
    ...leanChain([]),
    ...sortLeanChain([]),
  }));
  campaigns.findOne.mockReturnValue(
    leanChain({
      _id: campaignId,
      orgId: new Types.ObjectId(ORG_ID),
      title: 'T',
      type: 'independent',
      status: 'draft',
      createdBy: new Types.ObjectId(USER_ID),
    }),
  );
  return { service, campaigns, sessions, campaignId };
}

function dto(overrides: Partial<CreateCampaignDto> = {}): CreateCampaignDto {
  return {
    title: 'Pulse',
    type: 'independent',
    objective: 'Learn things',
    ...overrides,
  };
}

describe('CampaignsService.create — independent', () => {
  it('creates exactly two child sessions bound to the campaign and org', async () => {
    const { service, campaigns, sessions, campaignId } = makeService();

    await service.create(ACTOR, dto({ sessionCount: 2 }));

    expect(sessions.insertMany).toHaveBeenCalledTimes(1);
    const docs = sessions.insertMany.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(docs).toHaveLength(2);
    for (const d of docs) {
      expect(d.campaignId).toBe(campaignId);
      expect((d.orgId as Types.ObjectId).toString()).toBe(ORG_ID);
      expect(d.status).toBe('draft');
      expect(d.wizardStep).toBe('schedule');
    }
    expect(docs.map((d) => d.title)).toEqual(['Pulse — Session 1', 'Pulse — Session 2']);
    expect(campaigns.create.mock.calls[0][0].sessionsTotal).toBe(2);
  });

  it('runs sessions side by side (same window), not as a staggered sequence', async () => {
    const { service, sessions } = makeService();

    await service.create(ACTOR, dto({ sessionCount: 2, startAt: '2030-01-01T00:00:00.000Z' }));

    const docs = sessions.insertMany.mock.calls[0][0] as Array<{ startAt: Date; endAt: Date }>;
    expect(docs[0].startAt.getTime()).toBe(docs[1].startAt.getTime());
    expect(docs[0].endAt.getTime()).toBe(docs[1].endAt.getTime());
  });

  it('does not apply linked behaviour even if linked fields are sent', async () => {
    const { service, campaigns } = makeService();

    await service.create(
      ACTOR,
      dto({
        sessionCount: 2,
        masterPrompt: 'ignore me',
        linkedSequence: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
      }),
    );

    const created = campaigns.create.mock.calls[0][0];
    expect(created.masterPrompt).toBeNull();
    expect(created.linkedSequence).toEqual([]);
    expect(created.sessionsTotal).toBe(2);
  });

  it('keeps the one-session default and plain title for existing clients', async () => {
    const { service, sessions } = makeService();

    await service.create(ACTOR, dto());

    const docs = sessions.insertMany.mock.calls[0][0] as Array<{ title: string }>;
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Pulse');
  });

  it('rolls back the campaign and any children, scoped by org, when child creation fails', async () => {
    const { service, campaigns, sessions, campaignId } = makeService();
    sessions.insertMany.mockRejectedValue(new Error('insert failed'));

    await expect(service.create(ACTOR, dto({ sessionCount: 2 }))).rejects.toThrow('insert failed');

    const orgFilter = (f: { orgId: Types.ObjectId }) => f.orgId.toString();
    const delSessions = sessions.deleteMany.mock.calls[0][0];
    expect(delSessions.campaignId).toBe(campaignId);
    expect(orgFilter(delSessions)).toBe(ORG_ID);
    const delCampaign = campaigns.deleteOne.mock.calls[0][0];
    expect(delCampaign._id).toBe(campaignId);
    expect(orgFilter(delCampaign)).toBe(ORG_ID);
  });

  it('still surfaces the original error if rollback itself fails', async () => {
    const { service, sessions } = makeService();
    sessions.insertMany.mockRejectedValue(new Error('insert failed'));
    sessions.deleteMany.mockRejectedValue(new Error('cleanup failed'));

    await expect(service.create(ACTOR, dto({ sessionCount: 2 }))).rejects.toThrow('insert failed');
  });
});

describe('CampaignsService.create — linked and recurring unchanged', () => {
  it('linked: one session per step, staggered, with masterPrompt kept', async () => {
    const { service, campaigns, sessions } = makeService();

    await service.create(
      ACTOR,
      dto({
        type: 'linked',
        masterPrompt: 'brief',
        linkedSequence: [{ title: 'One' }, { title: 'Two' }],
        startAt: '2030-01-01T00:00:00.000Z',
      }),
    );

    const docs = sessions.insertMany.mock.calls[0][0] as Array<{ title: string; startAt: Date }>;
    expect(docs.map((d) => d.title)).toEqual(['Pulse — One', 'Pulse — Two']);
    expect(docs[1].startAt.getTime()).toBeGreaterThan(docs[0].startAt.getTime());
    expect(campaigns.create.mock.calls[0][0].masterPrompt).toBe('brief');
  });

  it('recurring: defaults to three staggered rounds', async () => {
    const { service, sessions } = makeService();

    await service.create(ACTOR, dto({ type: 'recurring' }));

    const docs = sessions.insertMany.mock.calls[0][0] as Array<{ title: string; startAt: Date }>;
    expect(docs.map((d) => d.title)).toEqual([
      'Pulse — Round 1',
      'Pulse — Round 2',
      'Pulse — Round 3',
    ]);
    expect(docs[2].startAt.getTime()).toBeGreaterThan(docs[1].startAt.getTime());
  });
});

describe('CampaignsService.launch', () => {
  function makeLaunchService(type: 'independent' | 'linked') {
    const { service, campaigns, sessions, campaignId } = makeService();
    const mkSession = (n: number) => ({
      _id: new Types.ObjectId(),
      orgId: new Types.ObjectId(ORG_ID),
      title: `S${n}`,
      type: 'survey',
      status: 'draft',
      startAt: null,
      endAt: null,
      createdBy: new Types.ObjectId(USER_ID),
      progress: { invited: 0, completed: 0, percent: 0, health: 'no_schedule' },
      save: jest.fn().mockResolvedValue(undefined),
    });
    const docs = [mkSession(1), mkSession(2)];
    // find().sort() is awaited directly by launch() and chained to .lean() by getOne().
    const sorted = () => Object.assign(Promise.resolve(docs), { lean: () => Promise.resolve(docs) });
    sessions.find.mockImplementation(() => ({
      lean: () => Promise.resolve(docs),
      sort: sorted,
    }));
    campaigns.findOne.mockReturnValue(
      leanChain({
        _id: campaignId,
        orgId: new Types.ObjectId(ORG_ID),
        title: 'T',
        type,
        status: 'draft',
        sessionsTotal: 2,
        createdBy: new Types.ObjectId(USER_ID),
      }),
    );
    return { service, docs };
  }

  const window = {
    startAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    endAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  it('independent: every child session opens in the same window and goes ongoing', async () => {
    const { service, docs } = makeLaunchService('independent');

    await service.launch(ORG_ID, new Types.ObjectId().toString(), window);

    expect(docs[0].status).toBe('ongoing');
    expect(docs[1].status).toBe('ongoing');
    expect((docs[1].startAt as unknown as Date).getTime()).toBe(
      (docs[0].startAt as unknown as Date).getTime(),
    );
    expect(docs[0].save).toHaveBeenCalled();
    expect(docs[1].save).toHaveBeenCalled();
  });

  it('linked: second session is still scheduled later (unchanged behaviour)', async () => {
    const { service, docs } = makeLaunchService('linked');

    await service.launch(ORG_ID, new Types.ObjectId().toString(), window);

    expect(docs[0].status).toBe('ongoing');
    expect(docs[1].status).toBe('scheduled');
    expect((docs[1].startAt as unknown as Date).getTime()).toBeGreaterThan(
      (docs[0].startAt as unknown as Date).getTime(),
    );
  });
});

describe('CampaignsService.create — independent session names', () => {
  it('stores each custom name as its own Session title under the same campaign and org', async () => {
    const { service, campaigns, sessions, campaignId } = makeService();

    await service.create(
      ACTOR,
      dto({
        title: 'Q4 Employee Feedback',
        sessionCount: 2,
        sessionTitles: ['Employee Satisfaction Survey', '  Manager Feedback Survey '],
      }),
    );

    const docs = sessions.insertMany.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(docs.map((d) => d.title)).toEqual([
      'Employee Satisfaction Survey',
      'Manager Feedback Survey',
    ]);
    for (const d of docs) {
      expect(d.campaignId).toBe(campaignId);
      expect((d.orgId as Types.ObjectId).toString()).toBe(ORG_ID);
    }
    expect(campaigns.create.mock.calls[0][0].title).toBe('Q4 Employee Feedback');
    expect(campaigns.create.mock.calls[0][0].sessionsTotal).toBe(2);
  });

  it('rejects a blank session name without creating anything', async () => {
    const { service, campaigns, sessions } = makeService();

    await expect(
      service.create(ACTOR, dto({ sessionCount: 2, sessionTitles: ['Only one', '   '] })),
    ).rejects.toThrow('Each session requires a name');
    expect(campaigns.create).not.toHaveBeenCalled();
    expect(sessions.insertMany).not.toHaveBeenCalled();
  });

  it('rejects names that do not match the session count', async () => {
    const { service, campaigns } = makeService();

    await expect(
      service.create(ACTOR, dto({ sessionCount: 3, sessionTitles: ['A', 'B'] })),
    ).rejects.toThrow('must match');
    expect(campaigns.create).not.toHaveBeenCalled();
  });

  it('ignores sessionTitles on linked and recurring campaigns', async () => {
    const { service, sessions } = makeService();

    await service.create(ACTOR, dto({ type: 'recurring', sessionTitles: ['X', 'Y'] }));

    const docs = sessions.insertMany.mock.calls[0][0] as Array<{ title: string }>;
    expect(docs.map((d) => d.title)).toEqual([
      'Pulse — Round 1',
      'Pulse — Round 2',
      'Pulse — Round 3',
    ]);
  });
});
