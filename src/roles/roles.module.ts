import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RoleProfile, RoleProfileSchema } from '../schemas/role-profile.schema';
import {
  RbacAuditEvent,
  RbacAuditEventSchema,
} from '../schemas/rbac-audit-event.schema';
import { Role, RoleSchema } from '../schemas/role.schema';
import { User, UserSchema } from '../schemas/user.schema';
import { AuditService } from './audit.service';
import { CustomRolesService } from './custom-roles.service';
import { RoleAuthorityService } from './role-authority.service';
import { RoleProfilesService } from './role-profiles.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Role.name, schema: RoleSchema },
      { name: User.name, schema: UserSchema },
      { name: RoleProfile.name, schema: RoleProfileSchema },
      { name: RbacAuditEvent.name, schema: RbacAuditEventSchema },
    ]),
  ],
  controllers: [RolesController],
  providers: [
    RolesService,
    RoleProfilesService,
    RoleAuthorityService,
    CustomRolesService,
    AuditService,
  ],
  exports: [RolesService, RoleAuthorityService, AuditService],
})
export class RolesModule {}
