import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { GRANT_KEYS } from '@pulsefeedback/shared';

export class UpdateGrantsDto {
  @IsArray()
  @ArrayMaxSize(GRANT_KEYS.length)
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(GRANT_KEYS as string[], { each: true })
  grants!: string[];

  /** 0 = first save; otherwise the version last loaded by the client. */
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  expectedVersion!: number;
}
