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

  /**
   * Absent on every pre-existing role (legacy/system). 'custom' for roles created through Roles &
   * Permissions; 'owner' for the single per-organization Owner role created by the operator CLI.
   * Set exclusively by the server and never from client input.
   */
  @Prop({ type: String, enum: ['custom', 'owner'] })
  kind?: 'custom' | 'owner';

  @Prop()
  description?: string;

  /** Granular grants (custom roles only). Configuration — not enforced by the API yet. */
  @Prop({ type: [String], default: undefined })
  grants?: string[];

  /** Optimistic-concurrency counter (custom roles only). */
  @Prop()
  version?: number;

  /** Lower-cased, whitespace-normalised name (custom roles only) for case-insensitive uniqueness. */
  @Prop()
  nameKey?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  createdBy?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  updatedBy?: Types.ObjectId;
}

export const RoleSchema = SchemaFactory.createForClass(Role);
RoleSchema.index({ orgId: 1, name: 1 }, { unique: true });
// Additive and partial: legacy roles have no nameKey, so they are not indexed or affected.
RoleSchema.index(
  { orgId: 1, nameKey: 1 },
  { unique: true, partialFilterExpression: { nameKey: { $type: 'string' } } },
);
// At most one Owner ROLE per organization (who holds it is controlled by the operator CLI).
RoleSchema.index(
  { orgId: 1, kind: 1 },
  { unique: true, partialFilterExpression: { kind: 'owner' } },
);
