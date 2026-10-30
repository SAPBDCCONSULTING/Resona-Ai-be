import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RoleProfileDocument = HydratedDocument<RoleProfile>;

/**
 * Granular RBAC configuration per role profile (see shared/src/permission-registry.ts).
 * Deliberately a SEPARATE collection from `roles`: legacy roles, their `permissions` and user
 * assignments are untouched, and profiles stored here are not assignable to users.
 * `grants` are configuration only — nothing in the API enforces them yet (Stage 6).
 */
@Schema({ timestamps: true, collection: 'role_profiles' })
export class RoleProfile {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  orgId!: Types.ObjectId;

  @Prop({ required: true })
  profileKey!: string;

  @Prop({ type: [String], default: [] })
  grants!: string[];

  /** Optimistic-concurrency counter; starts at 1 on first save. */
  @Prop({ required: true, default: 1 })
  version!: number;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;
}

export const RoleProfileSchema = SchemaFactory.createForClass(RoleProfile);
RoleProfileSchema.index({ orgId: 1, profileKey: 1 }, { unique: true });
