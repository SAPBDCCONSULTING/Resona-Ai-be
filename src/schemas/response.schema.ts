import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ResponseDocument = HydratedDocument<Response>;

@Schema({ _id: false })
class Answer {
  @Prop({ required: true })
  topicId!: string;

  @Prop({ required: true, trim: true })
  text!: string;
}

@Schema({ timestamps: true, collection: 'responses' })
export class Response {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  orgId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Session', required: true, index: true })
  sessionId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: [Answer], default: [] })
  answers!: Answer[];

  @Prop({ type: Date, default: () => new Date() })
  submittedAt!: Date;
}

export const ResponseSchema = SchemaFactory.createForClass(Response);
ResponseSchema.index({ sessionId: 1, userId: 1 }, { unique: true });
ResponseSchema.index({ orgId: 1, userId: 1, submittedAt: -1 });
