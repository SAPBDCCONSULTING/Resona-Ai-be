import { IsMongoId, IsString } from 'class-validator';

export class AssignRoleDto {
  @IsString()
  @IsMongoId()
  roleId!: string;
}
