/**
 * Operator CLI: make an existing user the first Owner of an organization.
 *
 *   npm run rbac:bootstrap-owner -- --org <slug> --email <email> --confirm
 *   node dist/cli/bootstrap-owner.js --org <slug> --email <email> --confirm   (built image)
 *
 * Connects with MONGODB_URI. Whoever can run this already has database access; it is not exposed
 * over HTTP. See docs/rbac-owner-bootstrap.md.
 */
import { userInfo, hostname } from 'node:os';
import mongoose from 'mongoose';
import {
  Organization,
  OrganizationSchema,
} from '../schemas/organization.schema';
import {
  RbacAuditEvent,
  RbacAuditEventSchema,
} from '../schemas/rbac-audit-event.schema';
import { Role, RoleSchema } from '../schemas/role.schema';
import { User, UserSchema } from '../schemas/user.schema';
import {
  BootstrapError,
  bootstrapOwner,
  type BootstrapDeps,
} from '../roles/owner-bootstrap';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const orgSlug = arg('org');
  const email = arg('email');
  if (!orgSlug || !email || !process.argv.includes('--confirm')) {
    console.error(
      'Usage: bootstrap-owner --org <slug> --email <email> --confirm\n' +
        'Makes <email> the first Owner of the organization. Refuses if an Owner already exists.',
    );
    process.exit(2);
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set.');
    process.exit(2);
  }

  await mongoose.connect(uri);
  try {
    const result = await bootstrapOwner(
      {
        orgs: mongoose.model(
          Organization.name,
          OrganizationSchema,
        ) as unknown as BootstrapDeps['orgs'],
        roles: mongoose.model(
          Role.name,
          RoleSchema,
        ) as unknown as BootstrapDeps['roles'],
        users: mongoose.model(
          User.name,
          UserSchema,
        ) as unknown as BootstrapDeps['users'],
        audit: mongoose.model(
          RbacAuditEvent.name,
          RbacAuditEventSchema,
        ) as unknown as BootstrapDeps['audit'],
      },
      { orgSlug, email, operator: `${userInfo().username}@${hostname()}` },
    );
    console.log(
      `Done. ${email} is now the Owner of "${orgSlug}" (user ${result.userId}, role ${result.roleId}).\n` +
        'They must sign out and back in for the new permissions to apply.',
    );
  } catch (err) {
    console.error(
      err instanceof BootstrapError ? `Refused: ${err.message}` : err,
    );
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

void main();
