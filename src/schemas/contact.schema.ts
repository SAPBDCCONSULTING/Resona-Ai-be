import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ContactDocument = HydratedDocument<Contact>;

@Schema({ timestamps: true, collection: 'contacts' })
export class Contact {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  orgId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true, lowercase: true, index: true })
  email!: string;

  @Prop({ type: String, default: null })
  department!: string | null;

  @Prop({ type: [Types.ObjectId], ref: 'ContactGroup', default: [] })
  groupIds!: Types.ObjectId[];

  @Prop({ enum: ['employee', 'external'], default: 'employee' })
  contactType!: 'employee' | 'external';

  /** Linked login account, when one exists. Null until an account is created (future task). */
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  userId!: Types.ObjectId | null;
}

export const ContactSchema = SchemaFactory.createForClass(Contact);
ContactSchema.index({ orgId: 1, email: 1 }, { unique: true });

export type ContactGroupDocument = HydratedDocument<ContactGroup>;

@Schema({ timestamps: true, collection: 'contact_groups' })
export class ContactGroup {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  orgId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ default: 0 })
  memberCount!: number;
}

export const ContactGroupSchema = SchemaFactory.createForClass(ContactGroup);
ContactGroupSchema.index({ orgId: 1, name: 1 }, { unique: true });
