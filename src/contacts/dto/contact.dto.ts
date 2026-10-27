import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsTimeZone,
  Matches,
  MaxLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import {
  CONTACT_GENDERS,
  CONTACT_LANGUAGES,
  IANA_TIMEZONE_PATTERN,
  isValidDateOfBirth,
  type ContactGender,
  type ContactLanguage,
} from '@pulsefeedback/shared';

/** Emails are trimmed + lowercased before validation so " A@B.com " is accepted. */
const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Trimmed before validation so whitespace-only values fail @IsNotEmpty. */
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Optional fields: an empty box means "no value", stored as null. */
const trimOrNull = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() || null : value;

const IsDateOfBirth = () =>
  ValidateBy({
    name: 'isDateOfBirth',
    validator: {
      validate: (value: unknown) =>
        typeof value === 'string' && isValidDateOfBirth(value),
      defaultMessage: () =>
        'dateOfBirth must be a real date in YYYY-MM-DD format that is not in the future',
    },
  });

const LANGUAGE_MESSAGE = `preferredLanguage must be one of: ${CONTACT_LANGUAGES.join(', ')}`;
const TIMEZONE_MESSAGE =
  'timezone must be a valid IANA timezone such as Asia/Kolkata';
const GENDER_MESSAGE = `gender must be one of: ${CONTACT_GENDERS.join(', ')}`;

export class CreateContactDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  designation!: string;

  @Transform(trim)
  @Matches(IANA_TIMEZONE_PATTERN, { message: TIMEZONE_MESSAGE })
  @IsTimeZone({ message: TIMEZONE_MESSAGE })
  timezone!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  city!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  country!: string;

  @Transform(trim)
  @IsIn(CONTACT_GENDERS, { message: GENDER_MESSAGE })
  gender!: ContactGender;

  @IsOptional()
  @Transform(trimOrNull)
  @IsDateOfBirth()
  dateOfBirth?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsIn(CONTACT_LANGUAGES, { message: LANGUAGE_MESSAGE })
  preferredLanguage?: ContactLanguage | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string | null;

  @IsOptional()
  @IsEnum(['employee', 'external'])
  contactType?: 'employee' | 'external';
}

/**
 * Each profile field may be left out, so one field can be changed on its own.
 * @ValidateIf (not @IsOptional) is used because a field that is sent must hold
 * a real value: @IsOptional would also let null through and clear it.
 * dateOfBirth and preferredLanguage are optional, so for them null is allowed and clears.
 */
export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ValidateIf((o: UpdateContactDto) => o.designation !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  designation?: string;

  @ValidateIf((o: UpdateContactDto) => o.timezone !== undefined)
  @Transform(trim)
  @Matches(IANA_TIMEZONE_PATTERN, { message: TIMEZONE_MESSAGE })
  @IsTimeZone({ message: TIMEZONE_MESSAGE })
  timezone?: string;

  @ValidateIf((o: UpdateContactDto) => o.city !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  city?: string;

  @ValidateIf((o: UpdateContactDto) => o.country !== undefined)
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  country?: string;

  @ValidateIf((o: UpdateContactDto) => o.gender !== undefined)
  @Transform(trim)
  @IsIn(CONTACT_GENDERS, { message: GENDER_MESSAGE })
  gender?: ContactGender;

  @IsOptional()
  @Transform(trimOrNull)
  @IsDateOfBirth()
  dateOfBirth?: string | null;

  @IsOptional()
  @Transform(trimOrNull)
  @IsIn(CONTACT_LANGUAGES, { message: LANGUAGE_MESSAGE })
  preferredLanguage?: ContactLanguage | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  department?: string | null;

  @IsOptional()
  @IsEnum(['employee', 'external'])
  contactType?: 'employee' | 'external';
}
