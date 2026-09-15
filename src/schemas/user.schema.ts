import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true, index: true })
  orgId!: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  email!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ type: Types.ObjectId, ref: 'Role', required: true })
  roleId!: Types.ObjectId;

  @Prop({ default: 'en' })
  locale!: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
