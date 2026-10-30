import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  RbacAuditEvent,
  RbacAuditEventDocument,
} from '../schemas/rbac-audit-event.schema';

export interface AuditInput {
  orgId: Types.ObjectId;
  action: string;
  actorId: string;
  targetUserId?: Types.ObjectId | string;
  targetRoleId?: Types.ObjectId | string;
  detail?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(RbacAuditEvent.name)
    private readonly events: Model<RbacAuditEventDocument>,
  ) {}

  /**
   * Records an API action. Never throws: the change it describes has already been applied, so
   * failing the request here would only make the caller retry a completed operation.
   */
  async record(input: AuditInput): Promise<void> {
    try {
      await this.events.create({
        orgId: input.orgId,
        action: input.action,
        actorKind: 'user',
        actorId: new Types.ObjectId(input.actorId),
        targetUserId: input.targetUserId
          ? new Types.ObjectId(String(input.targetUserId))
          : undefined,
        targetRoleId: input.targetRoleId
          ? new Types.ObjectId(String(input.targetRoleId))
          : undefined,
        detail: input.detail,
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit event ${input.action}: ${String(err)}`,
      );
    }
  }
}
