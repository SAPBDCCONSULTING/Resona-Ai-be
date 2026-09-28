import {
  ArrayMinSize,
  IsArray,
  IsMongoId,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @MaxLength(120)
  name!: string;
}

export class UpdateGroupDto {
  @IsString()
  @MaxLength(120)
  name!: string;
}

export class AddGroupMembersDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsMongoId({ each: true })
  contactIds!: string[];
}
