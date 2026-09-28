import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ConversationDocument = HydratedDocument<Conversation>;

@Schema({ _id: false })
class ConversationMessage {
  @Prop({ required: true, enum: ['user', 'assistant'] })
  role!: 'user' | 'assistant';

  @Prop({ required: true, trim: true })
  content!: string;

  @Prop({ type: String, default: null })
  topicId!: string | null;

  @Prop({ type: Date, default: () => new Date() })
  createdAt!: Date;
}

@Schema({ _id: false })
class TopicSummary {
  @Prop({ required: true })
  topicId!: string;

  @Prop({ required: true, trim: true })
  text!: string;
}

@Schema({ timestamps: true, collection: 'conversations' })
export class Conversation {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  orgId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Session', required: true, index: true })
  sessionId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({
    required: true,
    enum: ['available', 'active', 'completed', 'expired'],
    default: 'available',
  })
  status!: 'available' | 'active' | 'completed' | 'expired';

  @Prop({ type: Number, default: 0 })
  currentTopicIndex!: number;

  @Prop({ type: [ConversationMessage], default: [] })
  messages!: ConversationMessage[];

  @Prop({ type: [TopicSummary], default: [] })
  topicSummaries!: TopicSummary[];

  @Prop({ type: Types.ObjectId, ref: 'Response', default: null })
  responseId!: Types.ObjectId | null;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ sessionId: 1, userId: 1 }, { unique: true });
ConversationSchema.index({ orgId: 1, userId: 1, updatedAt: -1 });
