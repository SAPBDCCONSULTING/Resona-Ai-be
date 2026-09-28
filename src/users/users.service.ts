import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { OrgUser } from '@pulsefeedback/shared';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roles: Model<RoleDocument>,
  ) {}

  async list(orgId: string): Promise<{ items: OrgUser[] }> {
    const orgObjectId = new Types.ObjectId(orgId);
    const [userDocs, roleDocs] = await Promise.all([
      this.users.find({ orgId: orgObjectId }).sort({ name: 1 }).lean(),
      this.roles.find({ orgId: orgObjectId }).lean(),
    ]);

    const roleNameById = new Map(roleDocs.map((r) => [String(r._id), r.name]));

    return {
      items: userDocs.map((u) =>
        this.toOrgUser(u, roleNameById.get(String(u.roleId)) ?? 'Unknown'),
      ),
    };
  }

  async assignRole(
    orgId: string,
    userId: string,
    roleId: string,
  ): Promise<OrgUser> {
    if (!Types.ObjectId.isValid(userId) || !Types.ObjectId.isValid(roleId)) {
      throw new BadRequestException('Invalid user or role id');
    }

    const orgObjectId = new Types.ObjectId(orgId);
    const role = await this.roles
      .findOne({ _id: roleId, orgId: orgObjectId })
      .lean();
    if (!role) {
      throw new BadRequestException('Role not found in this organization');
    }

    const user = await this.users
      .findOneAndUpdate(
        { _id: userId, orgId: orgObjectId },
        { $set: { roleId: role._id } },
        { new: true },
      )
      .lean();

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toOrgUser(user, role.name);
  }

  private toOrgUser(
    u: {
      _id: Types.ObjectId;
      orgId: Types.ObjectId;
      email: string;
      name: string;
      roleId: Types.ObjectId;
      locale?: string;
      createdAt?: Date;
    },
    roleName: string,
  ): OrgUser {
    return {
      id: String(u._id),
      orgId: String(u.orgId),
      email: u.email,
      name: u.name,
      roleId: String(u.roleId),
      roleName,
      locale: u.locale ?? 'en',
      createdAt: (u.createdAt ?? new Date()).toISOString(),
    };
  }
}
