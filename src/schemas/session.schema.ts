import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type {
  CampaignRecurringMode,
  CampaignType,
  HealthStatus,
  SessionStatus,
  SessionType,
} from '@pulsefeedback/shared';

export type SessionDocument = HydratedDocument<Session>;

@Schema({ _id: false })
class Progress {
  @Prop({ default: 0 })
  invited!: number;

  @Prop({ default: 0 })
  completed!: number;

  @Prop({ default: 0 })
  percent!: number;

  @Prop({ default: 'no_schedule' })
  health!: HealthStatus;
}

@Schema({ _id: false })
class Topic {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ default: 0 })
  order!: number;
}

@Schema({ timestamps: true, collection: 'sessions' })
export class Session {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  orgId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  /** one_on_one | survey only — never focus_group */
  @Prop({ required: true, enum: ['one_on_one', 'survey'], index: true })
  type!: SessionType;

  @Prop({
    required: true,
    enum: ['draft', 'scheduled', 'ongoing', 'completed', 'archived'],
    default: 'draft',
    index: true,
  })
  status!: SessionStatus;

  @Prop({ type: Date, default: null, index: true })
  startAt!: Date | null;

  @Prop({ type: Date, default: null, index: true })
  endAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  /** Denormalized for board cards (avoid join on list). */
  @Prop({ required: true, default: '' })
  createdByName!: string;

  @Prop({ type: Types.ObjectId, ref: 'Campaign', default: null, index: true })
  campaignId!: Types.ObjectId | null;

  @Prop({ type: Progress, default: () => ({}) })
  progress!: Progress;

  @Prop({ default: false, index: true })
  favorite!: boolean;

  @Prop({ type: [Topic], default: [] })
  topics!: Topic[];

  @Prop({ type: String, default: null })
  goalPrompt!: string | null;

  /** Create-flow resume: choose_type → … → schedule */
  @Prop({
    type: String,
    enum: ['choose_type', 'describe', 'verify', 'participants', 'reports', 'schedule'],
    default: 'choose_type',
  })
  wizardStep!: string;

  @Prop({
    type: String,
    enum: ['blank', 'goal_first', 'quick_create'],
    default: 'blank',
  })
  entryMode!: string;

  @Prop({ type: String, default: null })
  tone!: string | null;

  @Prop({ type: String, default: null })
  reportTemplateId!: string | null;

  @Prop({ type: [String], default: [] })
  participantIds!: string[];

  /**
   * Resolved User ids for the currently-selected participantIds, computed at launch.
   * Contacts with no linked User account are skipped (see Contact.userId).
   * This is what employee-assignment queries key on — participantIds stays Contact ids.
   */
  @Prop({ type: [String], default: [] })
  assignedUserIds!: string[];

  /** Employee-facing title shown on join / invite. */
  @Prop({ type: String, default: null })
  participantTitle!: string | null;

  @Prop({ type: String, default: null })
  participantDescription!: string | null;

  @Prop({ type: String, default: null })
  welcomeMessage!: string | null;

  @Prop({ default: false })
  anonymous!: boolean;

  @Prop({
    type: {
      subject: { type: String, default: '' },
      header: { type: String, default: '' },
      body: { type: String, default: '' },
    },
    default: () => ({ subject: '', header: '', body: '' }),
  })
  invitation!: { subject: string; header: string; body: string };

  @Prop({ type: [String], default: [] })
  engagementMetrics!: string[];
}

export const SessionSchema = SchemaFactory.createForClass(Session);

/** Board list: filter by org + type + status, sort by end time */
SessionSchema.index({ orgId: 1, type: 1, status: 1, endAt: 1 });
/** Favorites chip */
SessionSchema.index({ orgId: 1, type: 1, favorite: 1, updatedAt: -1 });
/** Text search later (title) */
SessionSchema.index({ orgId: 1, title: 1 });

export type CampaignDocument = HydratedDocument<Campaign>;

@Schema({ _id: false })
class LinkedSequenceStep {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true })
  title!: string;

  @Prop({ default: 0 })
  order!: number;
}

@Schema({ timestamps: true, collection: 'campaigns' })
export class Campaign {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  orgId!: Types.ObjectId;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true, enum: ['recurring', 'linked', 'independent'] })
  type!: CampaignType;

  @Prop({
    required: true,
    enum: ['draft', 'scheduled', 'ongoing', 'completed', 'archived'],
    default: 'draft',
  })
  status!: SessionStatus;

  @Prop({ type: Date, default: null })
  startAt!: Date | null;

  @Prop({ type: Date, default: null })
  endAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ required: true, default: '' })
  createdByName!: string;

  @Prop({ type: String, default: null })
  cadence!: string | null;

  /** Campaign context. Null on campaigns created before these fields existed. */
  @Prop({ type: String, default: null })
  objective!: string | null;

  @Prop({ type: String, default: null })
  background!: string | null;

  @Prop({ type: String, default: null })
  targetAudience!: string | null;

  @Prop({ type: String, default: null })
  intendedDecision!: string | null;

  /** Only meaningful when type === 'recurring'. */
  @Prop({ type: String, enum: ['unlinked', 'linked'], default: null })
  recurringMode!: CampaignRecurringMode | null;

  /** Brief used to AI-draft Step 1 of a linked campaign (set later). */
  @Prop({ type: String, default: null })
  masterPrompt!: string | null;

  /** Planned steps for a linked campaign. */
  @Prop({ type: [LinkedSequenceStep], default: [] })
  linkedSequence!: LinkedSequenceStep[];

  @Prop({ type: Types.ObjectId, ref: 'SessionTemplate', default: null })
  sessionTemplateId!: Types.ObjectId | null;

  @Prop({ default: 0 })
  sessionsCompleted!: number;

  @Prop({ default: 0 })
  sessionsTotal!: number;

  @Prop({ default: 0 })
  percent!: number;

  @Prop({ default: 'no_schedule' })
  health!: HealthStatus;
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);
CampaignSchema.index({ orgId: 1, type: 1, status: 1 });
