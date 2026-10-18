import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { SessionType } from '@pulsefeedback/shared';

export type SessionTemplateDocument = HydratedDocument<SessionTemplate>;

@Schema({ _id: false })
class TemplateTopic {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ default: 0 })
  order!: number;
}

@Schema({ timestamps: true, collection: 'session_templates' })
export class SessionTemplate {
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

  @Prop({ type: String, required: true, enum: ['one_on_one', 'survey'], index: true })
  sessionType!: SessionType;

  @Prop({ type: String, default: null })
  goalPrompt!: string | null;

  @Prop({ type: [TemplateTopic], default: [] })
  topics!: TemplateTopic[];

  @Prop({ type: String, default: null })
  tone!: string | null;
}

export const SessionTemplateSchema =
  SchemaFactory.createForClass(SessionTemplate);
SessionTemplateSchema.index({ orgId: 1, sessionType: 1, name: 1 });
