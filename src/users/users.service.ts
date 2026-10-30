import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AssignableRole, OrgUser } from '@pulsefeedback/shared';
import { AuditService } from '../roles/audit.service';
import {
  RoleAuthorityService,
  isOwnerRole,
  mayAssign,
  type Actor,
  type Caller,
  type RoleLike,
} from '../roles/role-authority.service';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';

type UserLean = {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  email: string;
  name: string;
  roleId: Types.ObjectId;
  locale?: string;
  createdAt?: Date;
};

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roles: Model<RoleDocument>,
    private readonly authority: RoleAuthorityService,
    private readonly audit: AuditService,
  ) {}

  async list(caller: Caller): Promise<{ items: OrgUser[] }> {
    const actor = await this.authority.loadActor(caller, 'users:read');
    const [userDocs, roleDocs] = await Promise.all([
      this.users.find({ orgId: actor.orgId }).sort({ name: 1 }).lean(),
      this.roles.find({ orgId: actor.orgId }).lean(),
    ]);
    const roleById = new Map(
      (roleDocs as unknown as RoleLike[]).map((r) => [String(r._id), r]),
    );

    return {
      items: userDocs.map((u) => {
        const role = roleById.get(String(u.roleId));
        const blocked = this.changeBlockedReason(actor, String(u._id), role);
        return {
          ...this.toOrgUser(u, role?.name ?? 'Unknown', role?.kind),
          canChangeRole: blocked === null,
          roleChangeBlockedReason: blocked,
        };
      }),
    };
  }

  /** Roles the caller may hand out: org-scoped, never Owner, never beyond their own authority. */
  async assignableRoles(caller: Caller): Promise<{ items: AssignableRole[] }> {
    const actor = await this.authority.loadActor(caller, 'users:write');
    const docs = (await this.roles
      .find({ orgId: actor.orgId })
      .sort({ name: 1 })
      .lean()) as unknown as RoleLike[];
    return {
      items: docs
        .filter((r) => mayAssign(actor, r))
        .map((r) => ({
          id: String(r._id),
          name: r.name,
          kind: r.kind === 'custom' ? 'custom' : 'system',
        })),
    };
  }

  async assignRole(
    caller: Caller,
    userId: string,
    roleId: string,
  ): Promise<OrgUser> {
    // Fresh read of the caller: the JWT permission list can be hours stale.
    const actor = await this.authority.loadActor(caller, 'users:write');

    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(roleId)) {
      throw new BadRequestException('Invalid user or role id');
    }
    if (userId === actor.userId) {
      throw new ForbiddenException('You cannot change your own role.');
    }

    // Both lookups are scoped to the caller's organization, never to client-supplied org data.
    const role = (await this.roles
      .findOne({ _id: roleId, orgId: actor.orgId })
      .lean()) as unknown as RoleLike | null;
    if (!role) {
      throw new BadRequestException('Role not found in this organization');
    }
    const target = await this.users
      .findOne({ _id: userId, orgId: actor.orgId })
      .lean();
    if (!target) throw new NotFoundException('User not found');

    if (isOwnerRole(role)) {
      throw new ForbiddenException(
        'Owner access cannot be assigned through role assignment.',
      );
    }
    if (!mayAssign(actor, role)) {
      throw new ForbiddenException(
        'You cannot assign a role with permissions beyond your own.',
      );
    }
    const current = (await this.roles
      .findOne({ _id: target.roleId, orgId: actor.orgId })
      .lean()) as unknown as RoleLike | null;
    if (current && isOwnerRole(current)) {
      // Last-Owner protection: the Owner's role can only be changed by the operator CLI.
      throw new ForbiddenException(
        "The Owner's role is protected and cannot be changed here.",
      );
    }
    if (current && !mayAssign(actor, current)) {
      throw new ForbiddenException(
        'You cannot change the role of a user whose current role is beyond your authority.',
      );
    }

    // Conditional on the role we just read, so a concurrent change is a 409, not a silent overwrite.
    const updated = await this.users
      .findOneAndUpdate(
        { _id: target._id, orgId: actor.orgId, roleId: target.roleId },
        { $set: { roleId: role._id } },
        { new: true },
      )
      .lean();
    if (!updated) {
      throw new ConflictException(
        "This user's role changed since you loaded it. Reload and try again.",
      );
    }

    // The role could have been deleted between the lookup and the write; never leave a dangling id.
    const stillThere = await this.roles.exists({
      _id: role._id,
      orgId: actor.orgId,
    });
    if (!stillThere) {
      await this.users.updateOne(
        { _id: target._id, orgId: actor.orgId, roleId: role._id },
        { $set: { roleId: target.roleId } },
      );
      throw new ConflictException(
        'That role was deleted while you were assigning it.',
      );
    }

    await this.audit.record({
      orgId: actor.orgId,
      action: 'user.role.assign',
      actorId: actor.userId,
      targetUserId: target._id,
      targetRoleId: role._id,
      detail: { fromRoleId: String(target.roleId), toRoleId: String(role._id) },
    });

    return {
      ...this.toOrgUser(updated, role.name, role.kind),
      canChangeRole: true,
      roleChangeBlockedReason: null,
    };
  }

  /** Why the caller cannot change `userId`'s role, or null. Used for display; the write re-checks. */
  private changeBlockedReason(
    actor: Actor,
    userId: string,
    currentRole: RoleLike | undefined,
  ): string | null {
    if (!actor.legacyPermissions.has('users:write')) {
      return 'You do not have permission to change roles.';
    }
    if (userId === actor.userId) return 'You cannot change your own role.';
    if (currentRole && isOwnerRole(currentRole)) {
      return "The Owner's role is protected and cannot be changed here.";
    }
    if (currentRole && !mayAssign(actor, currentRole)) {
      return "This user's current role is beyond your authority.";
    }
    return null;
  }

  private toOrgUser(
    u: UserLean,
    roleName: string,
    kind?: 'custom' | 'owner',
  ): OrgUser {
    return {
      id: String(u._id),
      orgId: String(u.orgId),
      email: u.email,
      name: u.name,
      roleId: String(u.roleId),
      roleName,
      roleKind: kind === 'custom' ? 'custom' : 'system',
      locale: u.locale ?? 'en',
      createdAt: (u.createdAt ?? new Date()).toISOString(),
    };
  }
}
