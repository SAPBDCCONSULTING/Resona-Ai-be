import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RbacAuditEventDocument = HydratedDocument<RbacAuditEvent>;

/**
 * Append-only record of role / ownership changes. Written by the API (actorKind 'user') and by
 * the operator CLI (actorKind 'operator'). Nothing in the application updates or deletes these.
 */
@Schema({
  collection: 'rbac_audit_events',
  timestamps: { createdAt: 'at', updatedAt: false },
})
export class RbacAuditEvent {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  orgId!: Types.ObjectId;

  @Prop({ required: true })
  action!: string;

  @Prop({ required: true, enum: ['user', 'operator'] })
  actorKind!: 'user' | 'operator';

  @Prop({ type: Types.ObjectId, ref: 'User' })
  actorId?: Types.ObjectId;

  /** Human-readable actor, e.g. the OS account that ran the CLI. */
  @Prop()
  actorLabel?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  targetUserId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Role' })
  targetRoleId?: Types.ObjectId;

  @Prop({ type: Object })
  detail?: Record<string, unknown>;
}

export const RbacAuditEventSchema =
  SchemaFactory.createForClass(RbacAuditEvent);
RbacAuditEventSchema.index({ orgId: 1, at: -1 });
