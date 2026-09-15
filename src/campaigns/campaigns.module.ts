import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  Campaign,
  CampaignSchema,
  Session,
  SessionSchema,
} from '../schemas/session.schema';
import {
  SessionTemplate,
  SessionTemplateSchema,
} from '../schemas/session-template.schema';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Campaign.name, schema: CampaignSchema },
      { name: Session.name, schema: SessionSchema },
      { name: SessionTemplate.name, schema: SessionTemplateSchema },
    ]),
  ],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
