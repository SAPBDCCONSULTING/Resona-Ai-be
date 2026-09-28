import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { SessionType } from '@pulsefeedback/shared';

export type ReportTemplateDocument = HydratedDocument<ReportTemplate>;

@Schema({ timestamps: true, collection: 'report_templates' })
export class ReportTemplate {
  /** null = system/global template */
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    default: null,
    index: true,
  })
  orgId!: Types.ObjectId | null;

  @Prop({ required: true })
  name!: string;

  @Prop({ default: '' })
  description!: string;

  @Prop({ enum: ['summary', 'themes', 'scores', 'custom'], default: 'summary' })
  kind!: 'summary' | 'themes' | 'scores' | 'custom';

  @Prop({ type: [String], default: ['one_on_one', 'survey'] })
  sessionTypes!: SessionType[];
}

export const ReportTemplateSchema =
  SchemaFactory.createForClass(ReportTemplate);
