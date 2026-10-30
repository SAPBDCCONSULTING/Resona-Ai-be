import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  SESSION_TEMPLATE_STATUSES,
  SESSION_TEMPLATE_VISIBILITIES,
  SURVEY_RESPONSE_TYPES,
  type SessionTemplateStatus,
  type SessionTemplateVisibility,
  type SessionType,
  type SurveyResponseType,
} from '@pulsefeedback/shared';

export type SessionTemplateDocument = HydratedDocument<SessionTemplate>;

@Schema({ _id: false })
class TemplateTopic {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ default: 0 })
  order!: number;

  /** Survey questions only; left unset for 1:1 topics. */
  @Prop({ type: String, enum: [...SURVEY_RESPONSE_TYPES], default: undefined })
  responseType?: SurveyResponseType;

  @Prop({ type: [String], default: undefined })
  options?: string[];
}

const TemplateTopicSchema = SchemaFactory.createForClass(TemplateTopic);

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

  @Prop({
    type: String,
    required: true,
    enum: ['one_on_one', 'survey'],
    index: true,
  })
  sessionType!: SessionType;

  @Prop({ type: String, default: null })
  goalPrompt!: string | null;

  @Prop({ type: [TemplateTopicSchema], default: [] })
  topics!: TemplateTopic[];

  @Prop({ type: String, default: null })
  tone!: string | null;

  @Prop({ type: String, default: 'Other' })
  category!: string;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: String, default: '' })
  audience!: string;

  @Prop({ type: Number, default: 15, min: 1 })
  estimatedDurationMinutes!: number;

  @Prop({
    type: String,
    enum: [...SESSION_TEMPLATE_VISIBILITIES],
    default: 'organization',
  })
  visibility!: SessionTemplateVisibility;

  /** User id of the creator; null for system templates. */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy!: Types.ObjectId | null;

  @Prop({ type: Number, default: 1, min: 1 })
  version!: number;

  @Prop({
    type: String,
    enum: [...SESSION_TEMPLATE_STATUSES],
    default: 'published',
    index: true,
  })
  status!: SessionTemplateStatus;

  @Prop({ type: String, default: '' })
  rolloutSuggestion!: string;

  /** Themed pack, e.g. "Core" or "Wellbeing & Retention Pack". */
  @Prop({ type: String, default: null })
  pack!: string | null;

  @Prop({ type: Types.ObjectId, ref: 'SessionTemplate', default: null })
  sourceTemplateId!: Types.ObjectId | null;
}

export const SessionTemplateSchema =
  SchemaFactory.createForClass(SessionTemplate);
SessionTemplateSchema.index({ orgId: 1, sessionType: 1, name: 1 });
