import { Types } from 'mongoose';
import { SYSTEM_SESSION_TEMPLATES } from '../templates/system-templates';
import { SeedService } from './seed.service';

type UpdateCall = [Record<string, unknown>, Record<string, unknown>, unknown?];

/** Builds a SeedService with only the session-template model mocked. */
function makeSeed(existingByName: Record<string, Record<string, unknown>>) {
  const sessionTemplates = {
    updateOne: jest.fn((filter: Record<string, unknown>) =>
      Promise.resolve({
        upsertedCount:
          'name' in filter && !existingByName[filter.name as string] ? 1 : 0,
      }),
    ),
    findOne: jest.fn((filter: { name: string }) => ({
      lean: () => Promise.resolve(existingByName[filter.name] ?? null),
    })),
  };
  const unused = {} as never;
  const seed = new SeedService(
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    sessionTemplates as never,
  );
  const run = () =>
    (
      seed as unknown as { ensureSessionOutlineTemplates(): Promise<void> }
    ).ensureSessionOutlineTemplates();
  return { sessionTemplates, run };
}

describe('SeedService.ensureSessionOutlineTemplates', () => {
  it('inserts all 50 system templates with insert-only upserts', async () => {
    const { sessionTemplates, run } = makeSeed({});
    await run();

    const calls = sessionTemplates.updateOne.mock
      .calls as unknown as UpdateCall[];
    expect(calls).toHaveLength(50);
    for (const [filter, update, opts] of calls) {
      expect(filter.orgId).toBeNull();
      expect(typeof filter.name).toBe('string');
      // Only $setOnInsert — an existing document is never modified here.
      expect(Object.keys(update)).toEqual(['$setOnInsert']);
      expect(update.$setOnInsert).toMatchObject({
        orgId: null,
        visibility: 'system',
      });
      expect(opts).toEqual({ upsert: true });
    }
  });

  it('only fills metadata fields that an existing template lacks', async () => {
    const tpl = SYSTEM_SESSION_TEMPLATES[0];
    const existingId = new Types.ObjectId();
    const { sessionTemplates, run } = makeSeed({
      [tpl.name]: {
        _id: existingId,
        orgId: null,
        name: tpl.name,
        description: 'Edited description',
        topics: [{ id: 'x', title: 'Edited topic', order: 1 }],
        status: 'archived',
        category: 'Custom category',
      },
    });
    await run();

    const backfill = (
      sessionTemplates.updateOne.mock.calls as unknown as UpdateCall[]
    ).filter(([filter]) => filter._id === existingId);
    expect(backfill).toHaveLength(1);
    const set = backfill[0][1].$set as Record<string, unknown>;

    // Existing values (and all content fields) are left alone.
    expect(set).not.toHaveProperty('status');
    expect(set).not.toHaveProperty('category');
    expect(set).not.toHaveProperty('description');
    expect(set).not.toHaveProperty('topics');
    expect(set).not.toHaveProperty('name');
    // Missing metadata is filled in.
    expect(set).toMatchObject({
      tags: tpl.tags,
      pack: tpl.pack,
      visibility: 'system',
      rolloutSuggestion: tpl.rolloutSuggestion,
    });
  });

  it('does nothing to a template that already has all metadata', async () => {
    const tpl = SYSTEM_SESSION_TEMPLATES[0];
    const { sessionTemplates, run } = makeSeed({
      [tpl.name]: {
        _id: new Types.ObjectId(),
        ...tpl,
        orgId: null,
        visibility: 'system',
        createdBy: null,
        version: 3,
      },
    });
    await run();
    const sets = (
      sessionTemplates.updateOne.mock.calls as unknown as UpdateCall[]
    ).filter(([, update]) => '$set' in update);
    expect(sets).toHaveLength(0);
  });
});
