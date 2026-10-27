/**
 * Development-only: create one test account per built-in role (Owner, Admin, Analyst, Employee, plus
 * a user to receive a custom role) in a dedicated "rbac-dev" organization.
 *
 *   DEV_TEST_PASSWORD='<at least 12 chars>' npm run seed:dev-users
 *   npm run seed:dev-users -- --reset-passwords       (re-set the password of existing test users)
 *
 * No password is hardcoded: set DEV_TEST_PASSWORD, or one is generated and printed once. Refuses to
 * run when NODE_ENV=production or the database is not local. Idempotent. See docs/rbac-dev-testing.md.
 */
import { randomBytes } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
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
  DEV_ORG,
  DEV_USERS,
  assertSafeEnvironment,
  seedDevFixtures,
  type FixtureDeps,
} from '../seed/dev-fixtures';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set.');
    process.exit(2);
  }
  try {
    assertSafeEnvironment(
      process.env,
      uri,
      process.argv.includes('--allow-remote'),
    );
  } catch (err) {
    console.error(`Refused: ${(err as Error).message}`);
    process.exit(2);
  }

  const supplied = process.env.DEV_TEST_PASSWORD;
  const password = supplied ?? randomBytes(12).toString('base64url');

  await mongoose.connect(uri);
  try {
    const results = await seedDevFixtures(
      {
        orgs: mongoose.model(
          Organization.name,
          OrganizationSchema,
        ) as unknown as FixtureDeps['orgs'],
        roles: mongoose.model(
          Role.name,
          RoleSchema,
        ) as unknown as FixtureDeps['roles'],
        users: mongoose.model(
          User.name,
          UserSchema,
        ) as unknown as FixtureDeps['users'],
        audit: mongoose.model(
          RbacAuditEvent.name,
          RbacAuditEventSchema,
        ) as unknown as FixtureDeps['audit'],
      },
      {
        password,
        resetPasswords: process.argv.includes('--reset-passwords'),
        operator: `${userInfo().username}@${hostname()}`,
      },
    );
    console.log(`Organization "${DEV_ORG.slug}" ready. Test accounts:`);
    for (const r of results) {
      const state = r.created
        ? 'created'
        : r.passwordReset
          ? 'password reset'
          : 'already existed (unchanged)';
      console.log(`  ${r.email.padEnd(34)} ${r.role.padEnd(9)} ${state}`);
    }
    if (results.some((r) => r.created || r.passwordReset)) {
      console.log(
        supplied
          ? '\nPassword: the value of DEV_TEST_PASSWORD.'
          : `\nGenerated password (shown once): ${password}`,
      );
    }
    console.log(`\nAccounts: ${DEV_USERS.map((u) => u.email).join(', ')}`);
  } catch (err) {
    console.error(err instanceof Error ? `Failed: ${err.message}` : err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

void main();
