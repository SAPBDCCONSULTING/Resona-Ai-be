import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AppModule } from '../app.module';
import { Role, RoleDocument } from '../schemas/role.schema';
import { COVERED_ROLE_NAMES, computeKbPermissionGrants } from './kb-permissions-backfill.util';

/**
 * Explicit, idempotent, additive backfill for the kb:* permissions
 * introduced in Phase 2a.
 *
 * Why this exists: SeedService's role upserts use $setOnInsert, so they
 * only set permissions on a brand-new role document — an "Admin"/"Analyst"
 * role created before this change never picks up kb:* automatically just
 * because the app restarts. This script is the explicit, operator-run
 * procedure to backfill them onto existing roles. It does NOT run
 * automatically on app boot (SeedService.onModuleInit is untouched) and
 * does NOT run as part of the test suite — it only ever touches a database
 * when a person deliberately invokes it.
 *
 * Scope and safety:
 *   - Only touches role documents named exactly "Admin" or "Analyst" (see
 *     kb-permissions-backfill.util.ts). Any other role name — "Employee",
 *     or any custom role an org created — is never touched, so a role that
 *     should not have kb:publish/kb:archive never silently gets them.
 *   - $addToSet only: never removes a permission a role already has, so a
 *     role with extra custom permissions keeps them.
 *   - Idempotent: running it twice makes no further change the second time.
 *   - --dry-run previews every change with zero writes.
 *
 * Usage (run manually, after deploying this change, against the target
 * environment's MONGODB_URI):
 *   npm run migrate:kb-permissions -- --dry-run   # preview, no writes
 *   npm run migrate:kb-permissions                # apply
 */
async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const logger = new Logger('BackfillKbPermissions');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));

    let checked = 0;
    let changed = 0;

    for (const roleName of COVERED_ROLE_NAMES) {
      const roles = await roleModel.find({ name: roleName }).lean();
      for (const role of roles) {
        checked += 1;
        const missing = computeKbPermissionGrants(roleName, role.permissions ?? []);
        if (missing.length === 0) continue;

        changed += 1;
        logger.log(
          `${dryRun ? '[dry-run] would grant' : 'granting'} [${missing.join(', ')}] to role "${roleName}" ` +
            `(org ${String(role.orgId)}, role ${String(role._id)})`,
        );
        if (!dryRun) {
          await roleModel.updateOne(
            { _id: role._id },
            { $addToSet: { permissions: { $each: missing } } },
          );
        }
      }
    }

    logger.log(
      `Checked ${checked} role document(s) named ${COVERED_ROLE_NAMES.join('/')}; ` +
        `${changed} ${dryRun ? 'would be updated' : 'updated'}.`,
    );
    if (!dryRun && changed > 0) {
      logger.log(
        'Existing access tokens are unaffected until refresh — users pick up the new ' +
          'permissions on their next token refresh or next login (auth.service.ts already ' +
          're-reads the role document fresh on both refresh and login; no other change is needed).',
      );
    }
  } finally {
    await app.close();
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    // A CLI diagnostic tool run directly by an operator, not a server log
    // sink — the full error is what the person running it needs to see.
    // eslint-disable-next-line no-console
    console.error('Backfill failed:', err);
    process.exit(1);
  });
