import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ROLE_PROFILE_DEFS,
  GRANT_KEYS,
  normalizeGrants,
  type PermissionKey,
} from '@pulsefeedback/shared';
import {
  RoleProfile,
  RoleProfileDocument,
} from '../schemas/role-profile.schema';
import { effectivePermissions } from '../auth/effective-permissions';
import { Role, RoleDocument } from '../schemas/role.schema';
import { User, UserDocument } from '../schemas/user.schema';

/** The authenticated caller as identified by the JWT. Only `userId`/`orgId` are trusted here. */
export interface Caller {
  userId: string;
  orgId: string;
  roleId: string;
  permissions: string[];
}

/** The caller's authority, re-read from the database (the JWT can be up to 8h stale). */
export interface Actor {
  userId: string;
  orgId: Types.ObjectId;
  roleId: Types.ObjectId;
  /** Legacy permissions — the only thing the API enforces today. */
  legacyPermissions: ReadonlySet<string>;
  /** Granular grants the caller may delegate. Empty when their role has none configured. */
  grants: ReadonlySet<string>;
}

export interface RoleLike {
  _id: Types.ObjectId;
  name: string;
  permissions?: string[];
  kind?: 'custom' | 'owner';
  grants?: string[];
}

export function isSubset(
  items: Iterable<string>,
  of: ReadonlySet<string>,
): boolean {
  for (const i of items) if (!of.has(i)) return false;
  return true;
}

/** Items in exactly one of the two lists. */
export function symmetricDifference(a: string[], b: string[]): string[] {
  const sa = new Set(a);
  const sb = new Set(b);
  return [
    ...[...sa].filter((k) => !sb.has(k)),
    ...[...sb].filter((k) => !sa.has(k)),
  ];
}

const OWNER_NAME = ROLE_PROFILE_DEFS.find(
  (p) => p.profileKey === 'owner',
)!.name.toLowerCase();

/** Owner-level access is never granted through role assignment or custom roles. */
export function isOwnerRole(role: Pick<RoleLike, 'name' | 'kind'>): boolean {
  return role.kind === 'owner' || role.name.trim().toLowerCase() === OWNER_NAME;
}

/**
 * Handing out a CUSTOM role is a role-assignment act, so it also needs the granular
 * `roles.assign` grant on top of the legacy `users:write` the endpoint already requires.
 * Legacy roles keep their existing rule (no granular grant needed).
 */
export function mayAssign(actor: Actor, role: RoleLike): boolean {
  if (!withinAuthority(actor, role)) return false;
  return role.kind !== 'custom' || actor.grants.has('roles.assign');
}

/**
 * Legacy permissions that describe what a participant does, not administrative authority
 * (docs/rbac-legacy-mapping.md: "Unmapped — not an admin permission"). Excluded from the
 * authority comparison, otherwise an Admin could not assign the Employee role they have always
 * been able to assign. This is an exemption, not a legacy->granular mapping.
 */
const PARTICIPANT_ONLY_PERMISSIONS: ReadonlySet<string> = new Set([
  'responses:write',
]);

/**
 * Whether `actor` may hand out (or take away) `role`. Each role is measured on the axis it is
 * enforced on: legacy roles by their legacy permissions, custom roles by their granular grants.
 * No legacy<->granular mapping is applied.
 */
export function withinAuthority(actor: Actor, role: RoleLike): boolean {
  if (isOwnerRole(role)) return false;
  if (role.kind === 'custom') {
    return isSubset(role.grants ?? [], actor.grants);
  }
  return isSubset(
    (role.permissions ?? []).filter(
      (p) => !PARTICIPANT_ONLY_PERMISSIONS.has(p),
    ),
    actor.legacyPermissions,
  );
}

@Injectable()
export class RoleAuthorityService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Role.name) private readonly roles: Model<RoleDocument>,
    @InjectModel(RoleProfile.name)
    private readonly profiles: Model<RoleProfileDocument>,
  ) {}

  orgObjectId(orgId: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(orgId)) {
      throw new ForbiddenException('Invalid organization');
    }
    return new Types.ObjectId(orgId);
  }

  /**
   * Loads the caller from the database and requires `needed` (legacy) permission on their
   * CURRENT role. Fails closed: a missing user, role or permission is a 403.
   */
  async loadActor(caller: Caller, needed: PermissionKey): Promise<Actor> {
    const orgId = this.orgObjectId(caller.orgId);
    if (!Types.ObjectId.isValid(caller.userId)) {
      throw new ForbiddenException('Invalid user');
    }
    const user = await this.users.findOne({ _id: caller.userId, orgId }).lean();
    if (!user) throw new ForbiddenException('Your account was not found');
    const role = await this.roles.findOne({ _id: user.roleId, orgId }).lean();
    if (!role) throw new ForbiddenException('Your role was not found');

    const legacyPermissions = new Set<string>(effectivePermissions(role));
    if (!legacyPermissions.has(needed)) {
      throw new ForbiddenException('Missing required permission');
    }
    return {
      userId: String(user._id),
      orgId,
      roleId: role._id,
      legacyPermissions,
      grants: new Set(await this.grantsForRole(orgId, role)),
    };
  }

  /**
   * Granular grants configured for a role: a custom role's own grants, or the saved profile
   * linked to a legacy role by EXACT name (Admin/Analyst). Nothing configured => none.
   */
  async grantsForRole(
    orgId: Types.ObjectId,
    role: RoleLike,
  ): Promise<string[]> {
    if (role.kind === 'custom') return normalizeGrants(role.grants ?? []);
    // The Owner holds every grant by definition (created only by the operator CLI, never by API).
    if (role.kind === 'owner') return [...GRANT_KEYS];
    const def = ROLE_PROFILE_DEFS.find((d) => d.legacyRoleName === role.name);
    if (!def) return [];
    const saved = await this.profiles
      .findOne({ orgId, profileKey: def.profileKey })
      .lean();
    return normalizeGrants(saved?.grants ?? []);
  }
}
