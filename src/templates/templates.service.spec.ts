import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Model, Types } from 'mongoose';
import type { ReportTemplateDocument } from '../schemas/report-template.schema';
import type { SessionTemplateDocument } from '../schemas/session-template.schema';
import {
  normalizeTemplateTopics,
  sessionTemplateAccessFilter,
  TemplatesService,
} from './templates.service';

const ORG_ID = new Types.ObjectId().toHexString();
const USER_ID = new Types.ObjectId().toHexString();
const actor = { orgId: ORG_ID, userId: USER_ID };

const lean = <T>(value: T) => ({ lean: () => Promise.resolve(value) });

function makeService() {
  const model = {
    find: jest.fn(),
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    create: jest.fn((doc: Record<string, unknown>) =>
      Promise.resolve({
        toObject: () => ({ _id: new Types.ObjectId(), ...doc }),
      }),
    ),
  };
  const service = new TemplatesService(
    {} as Model<ReportTemplateDocument>,
    model as unknown as Model<SessionTemplateDocument>,
  );
  return { service, model };
}

const systemTemplate = {
  _id: new Types.ObjectId(),
  orgId: null,
  name: 'Employee Engagement Pulse',
  description: 'Measure engagement',
  sessionType: 'survey',
  goalPrompt: 'Measure engagement',
  tone: 'neutral',
  topics: [
    { id: 't1', title: 'Engagement', order: 1, responseType: 'scale' },
    { id: 't2', title: 'Ideas', order: 2, responseType: 'text' },
  ],
  category: 'Engagement',
  tags: ['engagement'],
  audience: 'All employees',
  estimatedDurationMinutes: 8,
  visibility: 'system',
  status: 'published',
  version: 1,
  pack: 'Core',
  rolloutSuggestion: 'Quarterly',
};

describe('normalizeTemplateTopics', () => {
  it('fills ids and order from position', () => {
    expect(
      normalizeTemplateTopics([{ id: '', title: ' Wins ' }], 'one_on_one'),
    ).toEqual([{ id: 't1', title: 'Wins', order: 1 }]);
  });

  it('drops survey settings from 1:1 topics', () => {
    expect(
      normalizeTemplateTopics(
        [{ id: 't1', title: 'Q', responseType: 'scale', options: ['a', 'b'] }],
        'one_on_one',
      ),
    ).toEqual([{ id: 't1', title: 'Q', order: 1 }]);
  });

  it('requires 2+ options for multiple choice', () => {
    expect(() =>
      normalizeTemplateTopics(
        [
          {
            id: 't1',
            title: 'Pick',
            responseType: 'multiple_choice',
            options: ['Only', ' Only '],
          },
        ],
        'survey',
      ),
    ).toThrow(BadRequestException);
  });

  it('dedupes options and drops them for text / yes_no answers', () => {
    expect(
      normalizeTemplateTopics(
        [
          {
            id: 't1',
            title: 'Pick',
            responseType: 'multiple_choice',
            options: ['A', ' A', 'B', ''],
          },
          { id: 't2', title: 'Yes?', responseType: 'yes_no', options: ['x'] },
        ],
        'survey',
      ),
    ).toEqual([
      {
        id: 't1',
        title: 'Pick',
        order: 1,
        responseType: 'multiple_choice',
        options: ['A', 'B'],
      },
      { id: 't2', title: 'Yes?', order: 2, responseType: 'yes_no' },
    ]);
  });
});

describe('sessionTemplateAccessFilter', () => {
  it('shows private templates only to their creator', () => {
    const filter = sessionTemplateAccessFilter(actor);
    expect(filter.$or).toEqual([
      { orgId: null },
      { orgId: new Types.ObjectId(ORG_ID), visibility: { $ne: 'private' } },
      {
        orgId: new Types.ObjectId(ORG_ID),
        visibility: 'private',
        createdBy: new Types.ObjectId(USER_ID),
      },
    ]);
  });
});

describe('TemplatesService', () => {
  it('lists only published templates by default', async () => {
    const { service, model } = makeService();
    model.find.mockReturnValue({ sort: () => lean([systemTemplate]) });

    const res = await service.listSessionTemplates(actor, {
      sessionType: 'survey',
    });

    const [[query]] = model.find.mock.calls as [[{ $and: unknown[] }]];
    expect(query.$and).toContainEqual({
      $or: [{ status: 'published' }, { status: { $exists: false } }],
    });
    expect(query.$and).toContainEqual({ sessionType: 'survey' });
    expect(res.items[0]).toMatchObject({
      name: 'Employee Engagement Pulse',
      visibility: 'system',
      readOnly: true,
    });
  });

  it('can list every status', async () => {
    const { service, model } = makeService();
    model.find.mockReturnValue({ sort: () => lean([]) });
    await service.listSessionTemplates(actor, { status: 'all' });
    const [[query]] = model.find.mock.calls as [[{ $and: unknown[] }]];
    expect(query.$and).toHaveLength(1); // access filter only
  });

  it('creates published org templates by default and keeps survey settings', async () => {
    const { service, model } = makeService();
    const dto = await service.createSessionTemplate(actor, {
      name: ' Pulse ',
      sessionType: 'survey',
      topics: [{ id: 't1', title: 'Mood', responseType: 'scale' }],
    });
    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Pulse',
        status: 'published',
        visibility: 'organization',
        createdBy: new Types.ObjectId(USER_ID),
        version: 1,
      }),
    );
    expect(dto.topics).toEqual([
      { id: 't1', title: 'Mood', order: 1, responseType: 'scale' },
    ]);
    expect(dto.readOnly).toBe(false);
  });

  it('refuses to update system templates', async () => {
    const { service, model } = makeService();
    model.findOne.mockReturnValue(lean(systemTemplate));
    await expect(
      service.updateSessionTemplate(actor, String(systemTemplate._id), {
        name: 'Mine now',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('updates org templates and bumps the version', async () => {
    const { service, model } = makeService();
    const orgTemplate = {
      ...systemTemplate,
      orgId: new Types.ObjectId(ORG_ID),
      visibility: 'organization',
    };
    model.findOne.mockReturnValue(lean(orgTemplate));
    model.findOneAndUpdate.mockReturnValue(
      lean({ ...orgTemplate, status: 'archived', version: 2 }),
    );

    const dto = await service.updateSessionTemplate(
      actor,
      String(orgTemplate._id),
      { status: 'archived' },
    );

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: orgTemplate._id, orgId: orgTemplate.orgId },
      { $set: { status: 'archived' }, $inc: { version: 1 } },
      { new: true },
    );
    expect(dto).toMatchObject({ status: 'archived', version: 2 });
  });

  it('returns 404 for an invalid or inaccessible id', async () => {
    const { service, model } = makeService();
    await expect(service.getSessionTemplate(actor, 'nope')).rejects.toThrow(
      NotFoundException,
    );
    model.findOne.mockReturnValue(lean(null));
    await expect(
      service.getSessionTemplate(actor, new Types.ObjectId().toHexString()),
    ).rejects.toThrow(NotFoundException);
  });

  it('duplicates a system template into the org as an editable draft', async () => {
    const { service, model } = makeService();
    model.findOne.mockReturnValue(lean(systemTemplate));

    const dto = await service.duplicateSessionTemplate(
      actor,
      String(systemTemplate._id),
    );

    expect(model.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: new Types.ObjectId(ORG_ID),
        name: 'Employee Engagement Pulse (copy)',
        status: 'draft',
        visibility: 'organization',
        sourceTemplateId: systemTemplate._id,
        category: 'Engagement',
        topics: systemTemplate.topics,
      }),
    );
    expect(dto).toMatchObject({
      readOnly: false,
      sourceTemplateId: String(systemTemplate._id),
    });
  });

  it('fills defaults for templates stored before metadata existed', () => {
    const { service } = makeService();
    const dto = service.toSessionDto({
      _id: new Types.ObjectId(),
      orgId: null,
      name: 'Manager 1:1 outline',
      sessionType: 'one_on_one',
      topics: [],
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(dto).toMatchObject({
      category: 'Other',
      tags: [],
      visibility: 'system',
      status: 'published',
      version: 1,
      estimatedDurationMinutes: 15,
      readOnly: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
