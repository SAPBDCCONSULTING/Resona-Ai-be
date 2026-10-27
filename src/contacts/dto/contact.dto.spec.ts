import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateContactDto, UpdateContactDto } from './contact.dto';

const VALID = {
  name: 'Asha Rao',
  email: 'asha@example.com',
  designation: 'Product Manager',
  timezone: 'Asia/Kolkata',
  city: 'Bengaluru',
  country: 'India',
  gender: 'female',
};

const PROFILE_FIELDS = [
  'designation',
  'timezone',
  'city',
  'country',
  'gender',
] as const;

/** Returns the names of the properties that failed validation. */
async function failures(
  cls: typeof CreateContactDto | typeof UpdateContactDto,
  body: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, body));
  return errors.map((e) => e.property);
}

describe('CreateContactDto', () => {
  it('accepts a contact with all profile fields', async () => {
    expect(await failures(CreateContactDto, VALID)).toEqual([]);
  });

  it('trims surrounding whitespace', () => {
    const dto = plainToInstance(CreateContactDto, {
      ...VALID,
      city: '  Pune  ',
    });
    expect(dto.city).toBe('Pune');
  });

  it.each(PROFILE_FIELDS)('rejects a missing %s', async (field) => {
    const body: Record<string, unknown> = { ...VALID };
    delete body[field];
    expect(await failures(CreateContactDto, body)).toEqual([field]);
  });

  it.each(PROFILE_FIELDS)(
    'rejects an empty or whitespace-only %s',
    async (field) => {
      expect(
        await failures(CreateContactDto, { ...VALID, [field]: '' }),
      ).toEqual([field]);
      expect(
        await failures(CreateContactDto, { ...VALID, [field]: '   ' }),
      ).toEqual([field]);
    },
  );

  it('rejects timezones that are not IANA identifiers', async () => {
    for (const timezone of ['IST', 'India time', 'Asia/Nowhere', 'GMT+5:30']) {
      expect(await failures(CreateContactDto, { ...VALID, timezone })).toEqual([
        'timezone',
      ]);
    }
  });

  it('accepts common IANA timezones', async () => {
    for (const timezone of ['Asia/Dubai', 'America/New_York', 'UTC']) {
      expect(await failures(CreateContactDto, { ...VALID, timezone })).toEqual(
        [],
      );
    }
  });

  it('rejects a gender outside the allowed list', async () => {
    expect(
      await failures(CreateContactDto, { ...VALID, gender: 'Female' }),
    ).toEqual(['gender']);
    expect(
      await failures(CreateContactDto, { ...VALID, gender: 'other' }),
    ).toEqual(['gender']);
  });
});

describe('UpdateContactDto', () => {
  it('accepts an empty update', async () => {
    expect(await failures(UpdateContactDto, {})).toEqual([]);
  });

  it.each(PROFILE_FIELDS)('accepts %s on its own', async (field) => {
    expect(await failures(UpdateContactDto, { [field]: VALID[field] })).toEqual(
      [],
    );
  });

  it('accepts an update that leaves the profile fields out', async () => {
    expect(await failures(UpdateContactDto, { name: 'Asha R.' })).toEqual([]);
  });

  it.each(PROFILE_FIELDS)('rejects clearing %s', async (field) => {
    expect(await failures(UpdateContactDto, { [field]: '' })).toEqual([field]);
    expect(await failures(UpdateContactDto, { [field]: '   ' })).toEqual([
      field,
    ]);
    expect(await failures(UpdateContactDto, { [field]: null })).toEqual([
      field,
    ]);
  });
});

describe('dateOfBirth and preferredLanguage', () => {
  it('are optional on create', async () => {
    expect(await failures(CreateContactDto, VALID)).toEqual([]);
    expect(
      await failures(CreateContactDto, {
        ...VALID,
        dateOfBirth: null,
        preferredLanguage: null,
      }),
    ).toEqual([]);
  });

  it('accepts a valid date of birth and language', async () => {
    expect(
      await failures(CreateContactDto, {
        ...VALID,
        dateOfBirth: '1990-02-28',
        preferredLanguage: 'hi',
      }),
    ).toEqual([]);
  });

  it('keeps the date of birth exactly as sent', () => {
    const dto = plainToInstance(CreateContactDto, {
      ...VALID,
      dateOfBirth: '1990-01-01',
    });
    expect(dto.dateOfBirth).toBe('1990-01-01');
  });

  it('treats an empty value as no value', () => {
    const dto = plainToInstance(UpdateContactDto, {
      dateOfBirth: '',
      preferredLanguage: '  ',
    });
    expect(dto.dateOfBirth).toBeNull();
    expect(dto.preferredLanguage).toBeNull();
  });

  it('rejects dates that are malformed, impossible, too old or in the future', async () => {
    for (const dateOfBirth of [
      '28/02/1990',
      '1990-2-28',
      '1990-02-30',
      '1899-12-31',
      '2999-01-01',
      '1990-02-28T00:00:00.000Z',
    ]) {
      expect(
        await failures(CreateContactDto, { ...VALID, dateOfBirth }),
      ).toEqual(['dateOfBirth']);
    }
  });

  it('rejects a language outside the list', async () => {
    expect(
      await failures(CreateContactDto, {
        ...VALID,
        preferredLanguage: 'Hindi',
      }),
    ).toEqual(['preferredLanguage']);
  });

  it('can be set or cleared on their own when updating', async () => {
    expect(
      await failures(UpdateContactDto, { dateOfBirth: '1985-07-15' }),
    ).toEqual([]);
    expect(
      await failures(UpdateContactDto, { preferredLanguage: 'ta' }),
    ).toEqual([]);
    expect(
      await failures(UpdateContactDto, {
        dateOfBirth: null,
        preferredLanguage: null,
      }),
    ).toEqual([]);
  });
});
