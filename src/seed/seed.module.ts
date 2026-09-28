import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Organization,
  OrganizationSchema,
} from '../schemas/organization.schema';
import { Role, RoleSchema } from '../schemas/role.schema';
import { User, UserSchema } from '../schemas/user.schema';
import {
  Campaign,
  CampaignSchema,
  Session,
  SessionSchema,
} from '../schemas/session.schema';
import {
  Contact,
  ContactGroup,
  ContactGroupSchema,
  ContactSchema,
} from '../schemas/contact.schema';
import {
  ReportTemplate,
  ReportTemplateSchema,
} from '../schemas/report-template.schema';
import {
  SessionTemplate,
  SessionTemplateSchema,
} from '../schemas/session-template.schema';
import { SeedService } from './seed.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Organization.name, schema: OrganizationSchema },
      { name: Role.name, schema: RoleSchema },
      { name: User.name, schema: UserSchema },
      { name: Session.name, schema: SessionSchema },
      { name: Campaign.name, schema: CampaignSchema },
      { name: Contact.name, schema: ContactSchema },
      { name: ContactGroup.name, schema: ContactGroupSchema },
      { name: ReportTemplate.name, schema: ReportTemplateSchema },
      { name: SessionTemplate.name, schema: SessionTemplateSchema },
    ]),
  ],
  providers: [SeedService],
})
export class SeedModule {}
