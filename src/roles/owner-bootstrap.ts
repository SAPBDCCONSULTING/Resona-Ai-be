import type { Model, Types } from 'mongoose';
import type { OrganizationDocument } from '../schemas/organization.schema';
import type { RbacAuditEventDocument } from '../schemas/rbac-audit-event.schema';
import type { RoleDocument } from '../schemas/role.schema';
import type { UserDocument } from '../schemas/user.schema';
import { OWNER_LEGACY_PERMISSIONS, OWNER_ROLE_NAME } from './owner-role';

export interface BootstrapDeps {
  orgs: Model<OrganizationDocument>;
  roles: Model<RoleDocument>;
  users: Model<UserDocument>;
  audit: Model<RbacAuditEventDocument>;
}

export interface BootstrapInput {
  orgSlug: string;
  email: string;
  /** Who is running this, for the audit trail (the OS account of the operator). */
  operator: string;
}

export class BootstrapError extends Error {}

const MONGO_DUPLICATE_KEY = 11000;

/**
 * Makes one existing user the Owner of an organization that has none.
 *
 * This is deliberately NOT reachable over HTTP: it needs direct database access, i.e. it is an
 * operator action, so no frontend-supplied role, user or organization is ever trusted. It refuses
 * to run when the organization already has an Owner, so it can never add a second privileged
 * owner, and it refuses to take over a pre-existing role that merely happens to be called Owner.
 */
export async function bootstrapOwner(
  deps: BootstrapDeps,
  input: BootstrapInput,
): Promise<{ orgId: string; userId: string; roleId: string }> {
  const slug = input.orgSlug.trim();
  const email = input.email.trim().toLowerCase();
  if (!slug || !email)
    throw new BootstrapError('Organization slug and email are required.');

  const org = await deps.orgs.findOne({ slug }).lean();
  if (!org) throw new BootstrapError(`No organization with slug "${slug}".`);
  const orgId = org._id;

  const user = await deps.users.findOne({ email, orgId }).lean();
  if (!user) {
    throw new BootstrapError(`No user "${email}" in organization "${slug}".`);
  }

  const lookalike = await deps.roles
    .findOne({ orgId, name: OWNER_ROLE_NAME, kind: { $ne: 'owner' } })
    .lean();
  if (lookalike) {
    throw new BootstrapError(
      `A role named "${OWNER_ROLE_NAME}" already exists in "${slug}" but is not a system Owner role. ` +
        'Resolve it manually; it will not be converted automatically.',
    );
  }

  const existingOwner = await deps.roles
    .findOne({ orgId, kind: 'owner' })
    .lean();
  let ownerRoleId: Types.ObjectId;
  if (existingOwner) {
    ownerRoleId = existingOwner._id;
    const holders = await deps.users.countDocuments({
      orgId,
      roleId: ownerRoleId,
    });
    if (holders > 0) {
      throw new BootstrapError(
        `Organization "${slug}" already has an Owner. Bootstrap only creates the first Owner.`,
      );
    }
  } else {
    try {
      const created = await deps.roles.create({
        orgId,
        name: OWNER_ROLE_NAME,
        kind: 'owner',
        permissions: OWNER_LEGACY_PERMISSIONS,
      });
      ownerRoleId = created._id;
    } catch (err) {
      if ((err as { code?: number }).code === MONGO_DUPLICATE_KEY) {
        throw new BootstrapError(
          'The Owner role was created concurrently. Re-run to check the state.',
        );
      }
      throw err;
    }
  }

  const previousRoleId = user.roleId;
  const moved = await deps.users.updateOne(
    { _id: user._id, orgId, roleId: previousRoleId },
    { $set: { roleId: ownerRoleId } },
  );
  if (moved.modifiedCount !== 1) {
    throw new BootstrapError(
      'The user changed while bootstrapping. Re-run to check the state.',
    );
  }

  // Two operators racing: if more than one user now holds the Owner role, undo ours.
  const holders = await deps.users.countDocuments({
    orgId,
    roleId: ownerRoleId,
  });
  if (holders !== 1) {
    await deps.users.updateOne(
      { _id: user._id, orgId, roleId: ownerRoleId },
      { $set: { roleId: previousRoleId } },
    );
    throw new BootstrapError(
      'Another bootstrap ran at the same time; this one was rolled back.',
    );
  }

  const previous = await deps.roles
    .findOne({ _id: previousRoleId, orgId })
    .lean();
  await deps.audit.create({
    orgId,
    action: 'owner.bootstrap',
    actorKind: 'operator',
    actorLabel: input.operator,
    targetUserId: user._id,
    targetRoleId: ownerRoleId,
    detail: {
      email,
      previousRoleId: String(previousRoleId),
      previousRoleName: previous?.name ?? null,
    },
  });

  return {
    orgId: String(orgId),
    userId: String(user._id),
    roleId: String(ownerRoleId),
  };
}
