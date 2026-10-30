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
  CUSTOM_ROLE_DESCRIPTION_MAX,
  CUSTOM_ROLE_NAME_MAX,
  CUSTOM_ROLE_NAME_MIN,
  CUSTOM_ROLE_NAME_PATTERN,
  REGISTRY_VERSION,
  ROLE_PROFILE_DEFS,
  isGrantKey,
  normalizeGrants,
  normalizeRoleName,
  type CustomRoleItem,
  type CustomRolesResponse,
} from '@pulsefeedback/shared';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { AuditService } from './audit.service';
import {
  RoleAuthorityService,
  isOwnerRole,
  isSubset,
  symmetricDifference,
  type Actor,
  type Caller,
} from './role-authority.service';

const MONGO_DUPLICATE_KEY = 11000;
// Case-insensitive comparison for name uniqueness.
const CI = { locale: 'en', strength: 2 } as const;
// Names that would read as protected/system roles even if no such role exists in this org yet.
const RESERVED_NAMES = new Set(
  [...ROLE_PROFILE_DEFS.map((p) => p.name), 'Administrator', 'Super Admin'].map(
    (n) => n.toLowerCase(),
  ),
);

interface CustomRoleDoc {
  _id: Types.ObjectId;
  orgId: Types.ObjectId;
  name: string;
  description?: string;
  grants?: string[];
  version?: number;
  kind?: 'custom' | 'owner';
  permissions?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

interface CleanInput {
  name: string;
  description: string;
  grants: string[];
}

/**
 * Custom role lifecycle. A custom role is a `roles` document with kind='custom', EMPTY legacy
 * `permissions` (so it adds no enforced API access) and a separate `grants` list (configuration
 * only until Stage 6). Every mutation re-reads the caller from the database and re-validates.
 */
@Injectable()
export class CustomRolesService {
  constructor(
    @InjectModel(Role.name) private readonly roles: Model<RoleDocument>,
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    private readonly authority: RoleAuthorityService,
    private readonly audit: AuditService,
  ) {}

  // ---- reads ------------------------------------------------------------------------------

  async list(caller: Caller): Promise<CustomRolesResponse> {
    const actor = await this.authority.loadActor(caller, 'roles:read');
    const docs = (await this.roles
      .find({ orgId: actor.orgId, kind: 'custom' })
      .sort({ name: 1 })
      .collation(CI)
      .lean()) as unknown as CustomRoleDoc[];
    const counts = await this.userCounts(
      actor.orgId,
      docs.map((d) => d._id),
    );
    const canWrite = actor.legacyPermissions.has('roles:write');
    const mayCreate = canWrite && actor.grants.has('roles.create');
    return {
      registryVersion: REGISTRY_VERSION,
      items: docs.map((d) =>
        this.toItem(d, counts.get(String(d._id)) ?? 0, actor),
      ),
      delegableGrants: normalizeGrants(actor.grants),
      canCreate: mayCreate,
      createBlockedReason: !canWrite
        ? 'You do not have permission to create roles.'
        : actor.grants.size === 0
          ? 'Your own role has no configured permissions to delegate, so you cannot create roles yet. An Owner can configure them under Roles & Permissions → Admin.'
          : !actor.grants.has('roles.create')
            ? 'Your role is not allowed to create roles. An Owner can grant “Create roles” to it under Roles & Permissions.'
            : null,
    };
  }

  // ---- create -----------------------------------------------------------------------------

  async create(caller: Caller, input: unknown): Promise<CustomRoleItem> {
    const actor = await this.authority.loadActor(caller, 'roles:write');
    if (!actor.grants.has('roles.create')) {
      throw new ForbiddenException('Your role is not allowed to create roles.');
    }
    const clean = this.validate(input);
    this.assertCanDelegate(actor, clean.grants);
    await this.assertNameFree(actor.orgId, clean.name);

    let createdId: Types.ObjectId;
    try {
      const doc = await this.roles.create({
        orgId: actor.orgId,
        name: clean.name,
        nameKey: clean.name.toLowerCase(),
        description: clean.description,
        // Custom roles never carry legacy permissions: nothing here widens enforced access.
        permissions: [],
        kind: 'custom',
        grants: clean.grants,
        version: 1,
        createdBy: new Types.ObjectId(actor.userId),
        updatedBy: new Types.ObjectId(actor.userId),
      });
      createdId = doc._id;
      await this.audit.record({
        orgId: actor.orgId,
        action: 'role.create',
        actorId: actor.userId,
        targetRoleId: doc._id,
        detail: { name: clean.name, grants: clean.grants },
      });
    } catch (err) {
      if ((err as { code?: number }).code === MONGO_DUPLICATE_KEY) {
        throw new ConflictException('A role with this name already exists.');
      }
      throw err;
    }
    return this.reload(actor, createdId);
  }

  // ---- update -----------------------------------------------------------------------------

  async update(
    caller: Caller,
    roleId: string,
    input: unknown,
    expectedVersion: unknown,
  ): Promise<CustomRoleItem> {
    const actor = await this.authority.loadActor(caller, 'roles:write');
    if (
      typeof expectedVersion !== 'number' ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 1
    ) {
      throw new BadRequestException('Invalid expectedVersion');
    }
    const existing = await this.loadCustom(actor, roleId);
    const clean = this.validate(input);

    const reason = this.blockedReason(actor, existing, 'roles.update');
    if (reason) throw new ForbiddenException(reason);

    // The grants being added OR removed must all be ones the caller may delegate; everything
    // else must stay exactly as it was. (Without this a caller could strip grants they lack.)
    this.assertCanDelegate(
      actor,
      symmetricDifference(existing.grants ?? [], clean.grants),
    );
    if (clean.name.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameFree(actor.orgId, clean.name, existing._id);
    }

    let updated: unknown;
    try {
      updated = await this.roles
        .findOneAndUpdate(
          {
            _id: existing._id,
            orgId: actor.orgId,
            kind: 'custom',
            version: expectedVersion,
          },
          {
            $set: {
              name: clean.name,
              nameKey: clean.name.toLowerCase(),
              description: clean.description,
              grants: clean.grants,
              updatedBy: new Types.ObjectId(actor.userId),
            },
            $inc: { version: 1 },
          },
          { new: true },
        )
        .lean();
    } catch (err) {
      if ((err as { code?: number }).code === MONGO_DUPLICATE_KEY) {
        throw new ConflictException('A role with this name already exists.');
      }
      throw err;
    }
    if (!updated) {
      throw new ConflictException(
        'This role changed since you loaded it. Reload and try again.',
      );
    }
    await this.audit.record({
      orgId: actor.orgId,
      action: 'role.update',
      actorId: actor.userId,
      targetRoleId: existing._id,
      detail: {
        fromName: existing.name,
        toName: clean.name,
        fromGrants: existing.grants ?? [],
        toGrants: clean.grants,
      },
    });
    return this.reload(actor, existing._id);
  }

  // ---- delete -----------------------------------------------------------------------------

  async remove(caller: Caller, roleId: string): Promise<{ deleted: true }> {
    const actor = await this.authority.loadActor(caller, 'roles:write');
    const existing = await this.loadCustom(actor, roleId);

    const authorityReason = this.blockedReason(actor, existing, 'roles.delete');
    if (authorityReason) throw new ForbiddenException(authorityReason);

    const assigned = await this.countAssigned(actor.orgId, existing._id);
    if (assigned > 0) {
      throw new ConflictException(this.assignedMessage(assigned));
    }

    const deleted = (await this.roles
      .findOneAndDelete({
        _id: existing._id,
        orgId: actor.orgId,
        kind: 'custom',
      })
      .lean()) as unknown as CustomRoleDoc | null;
    if (!deleted) throw new NotFoundException('Role not found');

    // An assignment may have landed between the count and the delete. Without transactions
    // (single-node Mongo) the safe answer is to put the role back unchanged and report it.
    const late = await this.countAssigned(actor.orgId, deleted._id);
    if (late > 0) {
      await this.roles.collection.insertOne(deleted);
      throw new ConflictException(this.assignedMessage(late));
    }
    await this.audit.record({
      orgId: actor.orgId,
      action: 'role.delete',
      actorId: actor.userId,
      targetRoleId: deleted._id,
      detail: { name: deleted.name, grants: deleted.grants ?? [] },
    });
    return { deleted: true };
  }

  // ---- internals --------------------------------------------------------------------------

  private assignedMessage(n: number): string {
    return `This role is still assigned to ${n} ${
      n === 1 ? 'user' : 'users'
    }. Reassign them before deleting it.`;
  }

  private countAssigned(orgId: Types.ObjectId, roleId: Types.ObjectId) {
    return this.users.countDocuments({ orgId, roleId });
  }

  private async userCounts(
    orgId: Types.ObjectId,
    roleIds: Types.ObjectId[],
  ): Promise<Map<string, number>> {
    if (roleIds.length === 0) return new Map();
    const rows = await this.users.aggregate<{ _id: Types.ObjectId; n: number }>(
      [
        { $match: { orgId, roleId: { $in: roleIds } } },
        { $group: { _id: '$roleId', n: { $sum: 1 } } },
      ],
    );
    return new Map(rows.map((r) => [String(r._id), r.n]));
  }

  /** Org-scoped lookup. Existing-but-not-custom roles are protected: 403, not 404. */
  private async loadCustom(
    actor: Actor,
    roleId: string,
  ): Promise<CustomRoleDoc> {
    if (!Types.ObjectId.isValid(roleId)) {
      throw new BadRequestException('Invalid role id');
    }
    const doc = (await this.roles
      .findOne({ _id: roleId, orgId: actor.orgId })
      .lean()) as unknown as CustomRoleDoc | null;
    if (!doc) throw new NotFoundException('Role not found');
    if (doc.kind !== 'custom') {
      throw new ForbiddenException(
        'System roles are protected and cannot be changed or deleted here.',
      );
    }
    return doc;
  }

  private async reload(actor: Actor, id: Types.ObjectId) {
    const doc = (await this.roles
      .findOne({ _id: id, orgId: actor.orgId, kind: 'custom' })
      .lean()) as unknown as CustomRoleDoc | null;
    if (!doc) throw new NotFoundException('Role not found');
    const n = await this.countAssigned(actor.orgId, doc._id);
    return this.toItem(doc, n, actor);
  }

  /** Why the caller cannot modify/delete this role, or null. Shared by update, delete and list. */
  private blockedReason(
    actor: Actor,
    d: CustomRoleDoc,
    needed: 'roles.update' | 'roles.delete',
  ): string | null {
    if (!actor.legacyPermissions.has('roles:write')) {
      return 'You do not have permission to edit roles.';
    }
    if (!actor.grants.has(needed)) {
      return needed === 'roles.update'
        ? 'Your role is not allowed to edit roles.'
        : 'Your role is not allowed to delete roles.';
    }
    if (String(d._id) === String(actor.roleId)) {
      return 'You hold this role, so it cannot be changed from your own account.';
    }
    if (!isSubset(d.grants ?? [], actor.grants)) {
      return 'This role includes permissions beyond your own, so you cannot manage it.';
    }
    return null;
  }

  private assertCanDelegate(actor: Actor, grants: string[]) {
    const beyond = grants.filter((g) => !actor.grants.has(g));
    if (beyond.length > 0) {
      throw new ForbiddenException(
        `You cannot delegate permissions you do not hold: ${beyond.join(', ')}`,
      );
    }
  }

  private async assertNameFree(
    orgId: Types.ObjectId,
    name: string,
    exceptId?: Types.ObjectId,
  ) {
    if (RESERVED_NAMES.has(name.toLowerCase()) || isOwnerRole({ name })) {
      throw new BadRequestException(
        'This name is reserved for a system role. Choose a different name.',
      );
    }
    const clash = await this.roles
      .findOne({
        orgId,
        name,
        ...(exceptId ? { _id: { $ne: exceptId } } : {}),
      })
      .collation(CI)
      .select('_id')
      .lean();
    if (clash) {
      throw new ConflictException('A role with this name already exists.');
    }
  }

  /** Independent of the DTO: trims, bounds and checks every field. */
  private validate(input: unknown): CleanInput {
    const body = (input ?? {}) as Record<string, unknown>;
    const errors: string[] = [];

    const name =
      typeof body.name === 'string' ? normalizeRoleName(body.name) : '';
    if (name.length < CUSTOM_ROLE_NAME_MIN) {
      errors.push(
        `Role name must be at least ${CUSTOM_ROLE_NAME_MIN} characters`,
      );
    } else if (name.length > CUSTOM_ROLE_NAME_MAX) {
      errors.push(
        `Role name must be at most ${CUSTOM_ROLE_NAME_MAX} characters`,
      );
    } else if (!CUSTOM_ROLE_NAME_PATTERN.test(name)) {
      errors.push(
        "Role name may contain letters, numbers, spaces and - _ & . ' / ( ) only",
      );
    }

    const description =
      typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length === 0) errors.push('Description is required');
    else if (description.length > CUSTOM_ROLE_DESCRIPTION_MAX) {
      errors.push(
        `Description must be at most ${CUSTOM_ROLE_DESCRIPTION_MAX} characters`,
      );
    }

    const grants = body.grants;
    if (!Array.isArray(grants) || !grants.every(isGrantKey)) {
      throw new BadRequestException('Unknown or malformed permission key');
    }
    if (new Set(grants).size !== grants.length) {
      throw new BadRequestException('Duplicate permission keys');
    }
    if (grants.length === 0) errors.push('Select at least one permission');

    if (errors.length > 0) throw new BadRequestException(errors);
    return { name, description, grants: normalizeGrants(grants) };
  }

  private toItem(
    d: CustomRoleDoc,
    userCount: number,
    actor: Actor,
  ): CustomRoleItem {
    const editBlockedReason = this.blockedReason(actor, d, 'roles.update');
    const deleteBlockedReason =
      this.blockedReason(actor, d, 'roles.delete') ??
      (userCount > 0 ? this.assignedMessage(userCount) : null);
    return {
      id: String(d._id),
      name: d.name,
      description: d.description ?? '',
      // Re-filter on read so a key retired from the registry never reaches the client.
      grants: normalizeGrants(d.grants ?? []),
      version: d.version ?? 1,
      userCount,
      createdAt: (d.createdAt ?? new Date()).toISOString(),
      updatedAt: (d.updatedAt ?? new Date()).toISOString(),
      editable: editBlockedReason === null,
      editBlockedReason,
      deletable: deleteBlockedReason === null,
      deleteBlockedReason,
    };
  }
}
