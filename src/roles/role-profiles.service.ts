import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  REGISTRY_VERSION,
  ROLE_PROFILE_DEFS,
  getRoleProfileDef,
  isGrantKey,
  normalizeGrants,
  type LegacyRoleSummary,
  type RoleProfileDef,
  type RoleProfileItem,
  type RoleProfilesResponse,
} from '@pulsefeedback/shared';
import {
  RoleProfile,
  RoleProfileDocument,
} from '../schemas/role-profile.schema';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';
import type { Caller } from './role-authority.service';

export type { Caller };

interface Context {
  legacyRoles: LegacyRoleSummary[];
  /** The organization's real Owner role (kind='owner'), if the operator CLI has created it. */
  ownerRoleId: string | null;
  profileByKey: Map<
    string,
    { grants: string[]; version: number; updatedAt?: Date }
  >;
}

const MONGO_DUPLICATE_KEY = 11000;

/**
 * Reads/writes granular role-profile grants. Configuration only: this service never writes
 * `roles` (legacy roles/permissions) and nothing here changes effective API access.
 */
@Injectable()
export class RoleProfilesService {
  constructor(
    @InjectModel(RoleProfile.name)
    private readonly profiles: Model<RoleProfileDocument>,
    @InjectModel(Role.name) private readonly roles: Model<RoleDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
  ) {}

  async list(caller: Caller): Promise<RoleProfilesResponse> {
    const orgId = this.orgObjectId(caller.orgId);
    const ctx = await this.loadContext(orgId);
    const items = ROLE_PROFILE_DEFS.map((d) => this.buildItem(d, ctx, caller));

    const linkedIds = new Set(
      items.map((i) => i.legacyRole?.id).filter((id): id is string => !!id),
    );
    const unlinkedLegacyRoles = ctx.legacyRoles
      .filter((r) => !linkedIds.has(r.id))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { registryVersion: REGISTRY_VERSION, items, unlinkedLegacyRoles };
  }

  async updateGrants(
    caller: Caller,
    profileKey: string,
    grants: unknown,
    expectedVersion: unknown,
  ): Promise<RoleProfileItem> {
    const orgId = this.orgObjectId(caller.orgId);

    const profileDef = getRoleProfileDef(profileKey);
    if (!profileDef) throw new NotFoundException('Unknown role profile');

    // Independent of the DTO: security-relevant checks never rely on the transport layer.
    if (!Array.isArray(grants) || !grants.every(isGrantKey)) {
      throw new BadRequestException('Unknown or malformed permission key');
    }
    if (new Set(grants).size !== grants.length) {
      throw new BadRequestException('Duplicate permission keys');
    }
    if (
      typeof expectedVersion !== 'number' ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 0
    ) {
      throw new BadRequestException('Invalid expectedVersion');
    }

    const ctx = await this.loadContext(orgId);
    const reason = this.readOnlyReason(profileDef, ctx, caller);
    if (reason) throw new ForbiddenException(reason);

    const next = normalizeGrants(grants);
    const updatedBy = new Types.ObjectId(caller.userId);

    if (expectedVersion === 0) {
      try {
        await this.profiles.create({
          orgId,
          profileKey: profileDef.profileKey,
          grants: next,
          version: 1,
          updatedBy,
        });
      } catch (err) {
        if ((err as { code?: number }).code === MONGO_DUPLICATE_KEY) {
          throw new ConflictException(
            'This profile was saved by someone else. Reload and try again.',
          );
        }
        throw err;
      }
    } else {
      const updated = await this.profiles.findOneAndUpdate(
        { orgId, profileKey: profileDef.profileKey, version: expectedVersion },
        { $set: { grants: next, updatedBy }, $inc: { version: 1 } },
        { new: true },
      );
      if (!updated) {
        throw new ConflictException(
          'This profile changed since you loaded it. Reload and try again.',
        );
      }
    }

    const fresh = await this.loadContext(orgId);
    return this.buildItem(profileDef, fresh, caller);
  }

  // ---- internals --------------------------------------------------------------------------

  private orgObjectId(orgId: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(orgId)) {
      throw new ForbiddenException('Invalid organization');
    }
    return new Types.ObjectId(orgId);
  }

  private async loadContext(orgId: Types.ObjectId): Promise<Context> {
    const [roleDocs, profileDocs, counts] = await Promise.all([
      // Custom roles have their own directory; they are not legacy roles.
      this.roles.find({ orgId, kind: { $ne: 'custom' } }).lean(),
      this.profiles.find({ orgId }).lean(),
      this.users.aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { orgId } },
        { $group: { _id: '$roleId', n: { $sum: 1 } } },
      ]),
    ]);
    const countByRole = new Map(counts.map((c) => [String(c._id), c.n]));
    const ownerRoleId = roleDocs.find((r) => r.kind === 'owner')?._id;
    const legacyRoles: LegacyRoleSummary[] = roleDocs.map((r) => ({
      id: String(r._id),
      name: r.name,
      permissions: [...(r.permissions ?? [])],
      userCount: countByRole.get(String(r._id)) ?? 0,
    }));
    const profileByKey: Context['profileByKey'] = new Map(
      profileDocs.map((p) => [p.profileKey, p]),
    );
    return {
      legacyRoles,
      profileByKey,
      ownerRoleId: ownerRoleId ? String(ownerRoleId) : null,
    };
  }

  private linkedLegacyRole(
    d: RoleProfileDef,
    ctx: Context,
  ): LegacyRoleSummary | null {
    if (d.profileKey === 'owner') {
      // Linked by the server-controlled kind, never by name: a role merely NAMED Owner is not it.
      return ctx.legacyRoles.find((r) => r.id === ctx.ownerRoleId) ?? null;
    }
    if (!d.legacyRoleName) return null;
    // Exact-name link only — no fuzzy matching, no remapping.
    return ctx.legacyRoles.find((r) => r.name === d.legacyRoleName) ?? null;
  }

  private readOnlyReason(
    d: RoleProfileDef,
    ctx: Context,
    caller: Caller,
  ): string | null {
    if (d.profileKey === 'owner') {
      return 'Owner is a protected system role and cannot be edited.';
    }
    if (d.kind === 'template') {
      return 'This is a template. Use Create Role to define a custom role of your own.';
    }
    if (!caller.permissions.includes('roles:write')) {
      return 'You do not have permission to edit roles.';
    }
    const linked = this.linkedLegacyRole(d, ctx);
    if (linked && linked.id === caller.roleId) {
      // Prevents a role from widening (or silently rewriting) its own configuration.
      return 'You hold this role, so it cannot be changed from your own account.';
    }
    return null;
  }

  private buildItem(
    d: RoleProfileDef,
    ctx: Context,
    caller: Caller,
  ): RoleProfileItem {
    const legacyRole = this.linkedLegacyRole(d, ctx);
    const saved = ctx.profileByKey.get(d.profileKey);
    const reason = this.readOnlyReason(d, ctx, caller);
    return {
      profileKey: d.profileKey,
      name: d.name,
      description: d.description,
      kind: d.kind,
      legacyRole,
      config: saved
        ? {
            // Re-filter on read so a key retired from the registry never reaches the client.
            grants: normalizeGrants(saved.grants ?? []),
            version: saved.version,
            updatedAt: (saved.updatedAt ?? new Date()).toISOString(),
          }
        : null,
      assignable: legacyRole !== null && d.profileKey !== 'owner',
      userCount: legacyRole ? legacyRole.userCount : null,
      editable: reason === null,
      readOnlyReason: reason,
    };
  }
}
