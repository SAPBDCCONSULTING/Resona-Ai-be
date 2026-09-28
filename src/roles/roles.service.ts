import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Role as RoleDto } from '@pulsefeedback/shared';
import { Role, RoleDocument } from '../schemas/role.schema';

@Injectable()
export class RolesService {
  constructor(
    @InjectModel(Role.name) private readonly roles: Model<RoleDocument>,
  ) {}

  async list(orgId: string): Promise<{ items: RoleDto[] }> {
    const docs = await this.roles
      .find({ orgId: new Types.ObjectId(orgId) })
      .sort({ name: 1 })
      .lean();

    return {
      items: docs.map((d) => ({
        id: String(d._id),
        orgId: String(d.orgId),
        name: d.name,
        permissions: d.permissions ?? [],
      })),
    };
  }
}
