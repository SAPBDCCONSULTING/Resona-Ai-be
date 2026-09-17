import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateOrgDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  country?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  domain?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  timezone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  foundedYear?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logoUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  accentColor?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  accentSoft?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tagline?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  aiSystemPrompt?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedTopics?: string[];

  @IsOptional()
  @IsBoolean()
  piiRedactionEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3650)
  retentionDays?: number;

  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(3650)
  archiveAfterDays?: number;

  @IsOptional()
  @IsBoolean()
  softDeleteEnabled?: boolean;
}
