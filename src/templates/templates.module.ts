import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ReportTemplate,
  ReportTemplateSchema,
} from '../schemas/report-template.schema';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ReportTemplate.name, schema: ReportTemplateSchema },
    ]),
  ],
  controllers: [TemplatesController],
  providers: [TemplatesService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
