import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  CUSTOM_ROLE_DESCRIPTION_MAX,
  CUSTOM_ROLE_NAME_MAX,
  GRANT_KEYS,
} from '@pulsefeedback/shared';

/**
 * Transport-level shape only. CustomRolesService re-validates everything (names, grant keys,
 * authority) because security checks must not depend on the DTO layer. Note there is
 * deliberately no `kind`, `orgId`, `permissions` or `version` the client can set on create.
 */
export class CreateCustomRoleDto {
  @IsString()
  @MaxLength(CUSTOM_ROLE_NAME_MAX * 4)
  name!: string;

  @IsString()
  @MaxLength(CUSTOM_ROLE_DESCRIPTION_MAX * 4)
  description!: string;

  @IsArray()
  @ArrayMaxSize(GRANT_KEYS.length)
  @ArrayUnique()
  @IsString({ each: true })
  grants!: string[];
}

export class UpdateCustomRoleDto extends CreateCustomRoleDto {
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  expectedVersion!: number;
}
