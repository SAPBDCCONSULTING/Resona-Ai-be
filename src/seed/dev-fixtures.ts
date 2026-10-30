import * as bcrypt from 'bcryptjs';
import type { Model } from 'mongoose';
import type { OrganizationDocument } from '../schemas/organization.schema';
import type { RbacAuditEventDocument } from '../schemas/rbac-audit-event.schema';
import type { RoleDocument } from '../schemas/role.schema';
import type { UserDocument } from '../schemas/user.schema';
import { BootstrapError, bootstrapOwner } from '../roles/owner-bootstrap';
import { ADMIN_PERMS, ANALYST_PERMS, EMPLOYEE_PERMS } from './system-roles';

/**
 * Development-only test accounts, one per built-in role, in their OWN organization so no real
 * organization, user or role is read or modified. Created only by the explicit CLI
 * (`npm run seed:dev-users`); nothing here runs at application start-up and there is no HTTP route.
 */
export const DEV_ORG = { slug: 'rbac-dev', name: 'RBAC Dev Test Org' };
export const DEV_EMAIL_DOMAIN = 'rbac-dev.local';

export const DEV_USERS = [
  { key: 'owner', name: 'Test Owner', role: 'Owner' },
  { key: 'admin', name: 'Test Admin', role: 'Admin' },
  { key: 'analyst', name: 'Test Analyst', role: 'Analyst' },
  { key: 'employee', name: 'Test Employee', role: 'Employee' },
  // Holds Employee until an Owner assigns it a custom role during a demo.
  { key: 'custom', name: 'Test Custom Role User', role: 'Employee' },
].map((u) => ({ ...u, email: `${u.key}.test@${DEV_EMAIL_DOMAIN}` }));

const SAFE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'mongo']);

/** Throws unless this looks like a local development environment. */
export function assertSafeEnvironment(
  env: Record<string, string | undefined>,
  mongoUri: string,
  allowRemote = false,
): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to create test users: NODE_ENV=production.');
  }
  if (allowRemote) return;
  let host = '';
  try {
    host = new URL(mongoUri).hostname;
  } catch {
    throw new Error('MONGODB_URI is not a valid URI.');
  }
  if (!SAFE_HOSTS.has(host)) {
    throw new Error(
      `Refusing to create test users on non-local database host "${host}". ` +
        'Pass --allow-remote only for a non-production database you own.',
    );
  }
}

export interface FixtureDeps {
  orgs: Model<OrganizationDocument>;
  roles: Model<RoleDocument>;
  users: Model<UserDocument>;
  audit: Model<RbacAuditEventDocument>;
}

export interface FixtureResult {
  email: string;
  role: string;
  created: boolean;
  passwordReset: boolean;
}

export async function seedDevFixtures(
  deps: FixtureDeps,
  opts: { password: string; resetPasswords?: boolean; operator: string },
): Promise<FixtureResult[]> {
  if (opts.password.length < 12) {
    throw new Error('The test password must be at least 12 characters.');
  }
  const org =
    (await deps.orgs.findOne({ slug: DEV_ORG.slug }).lean()) ??
    (await deps.orgs.create(DEV_ORG)).toObject();

  const roleIds: Record<string, unknown> = {};
  for (const [name, permissions] of [
    ['Admin', ADMIN_PERMS],
    ['Analyst', ANALYST_PERMS],
    ['Employee', EMPLOYEE_PERMS],
  ] as const) {
    const role = await deps.roles.findOneAndUpdate(
      { orgId: org._id, name },
      { $setOnInsert: { orgId: org._id, name, permissions } },
      { upsert: true, new: true },
    );
    roleIds[name] = role._id;
  }

  const hash = await bcrypt.hash(opts.password, 10);
  const results: FixtureResult[] = [];
  for (const u of DEV_USERS) {
    const existing = await deps.users.findOne({ email: u.email }).lean();
    if (existing && String(existing.orgId) !== String(org._id)) {
      throw new Error(
        `${u.email} exists in another organization; refusing to touch it.`,
      );
    }
    let created = false;
    let passwordReset = false;
    if (!existing) {
      await deps.users.create({
        orgId: org._id,
        email: u.email,
        name: u.name,
        passwordHash: hash,
        // The Owner starts as Admin; it is promoted below by the same audited bootstrap routine
        // the operator CLI uses, so there is only one way an Owner can come into existence.
        roleId: roleIds[u.role === 'Owner' ? 'Admin' : u.role] as never,
        locale: 'en',
      });
      created = true;
    } else if (opts.resetPasswords) {
      await deps.users.updateOne(
        { _id: existing._id },
        { $set: { passwordHash: hash } },
      );
      passwordReset = true;
    }
    results.push({ email: u.email, role: u.role, created, passwordReset });
  }

  const ownerEmail = DEV_USERS[0].email;
  try {
    await bootstrapOwner(deps, {
      orgSlug: DEV_ORG.slug,
      email: ownerEmail,
      operator: opts.operator,
    });
  } catch (err) {
    // Already bootstrapped by an earlier run is fine; anything else is a real problem.
    if (
      !(err instanceof BootstrapError) ||
      !/already has an Owner/.test(err.message)
    ) {
      throw err;
    }
    const ownerRole = await deps.roles
      .findOne({ orgId: org._id, kind: 'owner' })
      .lean();
    const holder = await deps.users
      .findOne({ orgId: org._id, roleId: ownerRole?._id })
      .lean();
    if (holder?.email !== ownerEmail) {
      throw new Error(
        `The ${DEV_ORG.slug} organization has a different Owner (${holder?.email}).`,
      );
    }
  }
  return results;
}
