import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OrganizationDocument = HydratedDocument<Organization>;

@Schema({ timestamps: true, collection: 'organizations' })
export class Organization {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, unique: true, index: true })
  slug!: string;

  @Prop({ type: String, default: null })
  address!: string | null;

  @Prop({ type: String, default: null })
  country!: string | null;

  @Prop({ type: String, default: null })
  description!: string | null;

  @Prop({ type: String, default: null })
  website!: string | null;

  @Prop({ type: String, default: null })
  domain!: string | null;

  @Prop({ type: String, default: null })
  phone!: string | null;

  @Prop({ type: String, default: null })
  timezone!: string | null;

  @Prop({ type: String, default: null })
  foundedYear!: string | null;

  @Prop({ type: String, default: null })
  logoUrl!: string | null;

  @Prop({ type: String, default: null })
  accentColor!: string | null;

  @Prop({ type: String, default: null })
  accentSoft!: string | null;

  @Prop({ type: String, default: null })
  tagline!: string | null;

  /** AI / privacy guardrails (S5) */
  @Prop({ type: String, default: null })
  aiSystemPrompt!: string | null;

  @Prop({ type: [String], default: [] })
  blockedTopics!: string[];

  @Prop({ type: Boolean, default: true })
  piiRedactionEnabled!: boolean;

  /** Data retention policies (S5) */
  @Prop({ type: Number, default: 365 })
  retentionDays!: number;

  @Prop({ type: Number, default: 90 })
  archiveAfterDays!: number;

  @Prop({ type: Boolean, default: true })
  softDeleteEnabled!: boolean;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);
