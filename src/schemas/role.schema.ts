import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { PermissionKey } from '@pulsefeedback/shared';

export type RoleDocument = HydratedDocument<Role>;

@Schema({ timestamps: true, collection: 'roles' })
export class Role {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  orgId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ type: [String], default: [] })
  permissions!: PermissionKey[];
}

export const RoleSchema = SchemaFactory.createForClass(Role);
RoleSchema.index({ orgId: 1, name: 1 }, { unique: true });
