import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateSessionTemplateDto,
  DuplicateSessionTemplateDto,
  ListSessionTemplatesQueryDto,
  UpdateSessionTemplateDto,
} from './session-template.dto';

const VALID = {
  name: 'Team Pulse',
  description: 'Weekly pulse',
  sessionType: 'survey',
  goalPrompt: 'Check how the team is doing',
  tone: 'neutral',
  topics: [
    {
      id: 't1',
      title: 'Mood',
      order: 1,
      responseType: 'scale',
      options: ['Low', 'Okay', 'High'],
    },
    {
      id: 't2',
      title: 'Focus area',
      responseType: 'multiple_choice',
      options: ['Workload', 'Growth'],
    },
    { id: 't3', title: 'Anything else?', responseType: 'text' },
  ],
  category: 'Engagement',
  tags: ['pulse'],
  audience: 'All employees',
  estimatedDurationMinutes: 5,
  visibility: 'private',
  status: 'draft',
  rolloutSuggestion: 'Send weekly',
};

type DtoClass = new () => object;

/** Returns the names of the properties that failed validation. */
async function failures(
  cls: DtoClass,
  body: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body));
  return errors.map((e) => e.property);
}

describe('CreateSessionTemplateDto', () => {
  it('accepts a template with metadata and survey questions', async () => {
    expect(await failures(CreateSessionTemplateDto, VALID)).toEqual([]);
  });

  it('still accepts the minimal body the existing UI sends', async () => {
    expect(
      await failures(CreateSessionTemplateDto, {
        name: 'Outline',
        description: '',
        sessionType: 'one_on_one',
        goalPrompt: null,
        topics: [{ id: 't1', title: 'Wins', order: 1 }],
      }),
    ).toEqual([]);
  });

  it('rejects system visibility (reserved for built-in templates)', async () => {
    expect(
      await failures(CreateSessionTemplateDto, {
        ...VALID,
        visibility: 'system',
      }),
    ).toEqual(['visibility']);
  });

  it('rejects creating an archived template', async () => {
    expect(
      await failures(CreateSessionTemplateDto, {
        ...VALID,
        status: 'archived',
      }),
    ).toEqual(['status']);
  });

  it('rejects an unknown response type', async () => {
    expect(
      await failures(CreateSessionTemplateDto, {
        ...VALID,
        topics: [{ id: 't1', title: 'Q', responseType: 'slider' }],
      }),
    ).toEqual(['topics']);
  });

  it.each([0, 481, 2.5])(
    'rejects an estimated duration of %s',
    async (minutes) => {
      expect(
        await failures(CreateSessionTemplateDto, {
          ...VALID,
          estimatedDurationMinutes: minutes,
        }),
      ).toEqual(['estimatedDurationMinutes']);
    },
  );

  it('trims the name', () => {
    const dto = plainToInstance(CreateSessionTemplateDto, {
      ...VALID,
      name: '  Pulse  ',
    });
    expect(dto.name).toBe('Pulse');
  });
});

describe('UpdateSessionTemplateDto', () => {
  it('accepts an empty patch', async () => {
    expect(await failures(UpdateSessionTemplateDto, {})).toEqual([]);
  });

  it('allows archiving', async () => {
    expect(
      await failures(UpdateSessionTemplateDto, { status: 'archived' }),
    ).toEqual([]);
  });

  it('rejects switching to system visibility', async () => {
    expect(
      await failures(UpdateSessionTemplateDto, { visibility: 'system' }),
    ).toEqual(['visibility']);
  });
});

describe('DuplicateSessionTemplateDto', () => {
  it('accepts an empty body', async () => {
    expect(await failures(DuplicateSessionTemplateDto, {})).toEqual([]);
  });

  it('rejects an archived copy', async () => {
    expect(
      await failures(DuplicateSessionTemplateDto, { status: 'archived' }),
    ).toEqual(['status']);
  });
});

describe('ListSessionTemplatesQueryDto', () => {
  it('accepts status=all and other filters', async () => {
    expect(
      await failures(ListSessionTemplatesQueryDto, {
        sessionType: 'survey',
        status: 'all',
        visibility: 'system',
        pack: 'Core',
      }),
    ).toEqual([]);
  });

  it('rejects an unknown status', async () => {
    expect(
      await failures(ListSessionTemplatesQueryDto, { status: 'deleted' }),
    ).toEqual(['status']);
  });
});
