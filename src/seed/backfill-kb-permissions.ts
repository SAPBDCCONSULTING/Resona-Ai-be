import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { PermissionKey } from '@pulsefeedback/shared';
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
 * Observability note (fixed — this previously printed nothing at all):
 * NestFactory.createApplicationContext(AppModule, { logger: false }) is
 * used here to silence Nest's own framework bootstrap noise (module
 * initialization logs), but @nestjs/common's Logger class holds its
 * "disabled" flag at the STATIC/process level — passing `logger: false`
 * silences every Logger instance in the whole process, including one this
 * script creates for its own diagnostic output, before or after that
 * call. That is why the previous version's `new Logger(...).log(...)`
 * calls (including the final "Checked N role document(s)" summary) never
 * printed anything, dry-run or not — not a permissions-logic bug, a
 * logging one. The fix: this script's own operator-facing output goes
 * through plain console.log/console.error (see run() below), which
 * Logger's static override has no effect on — exactly the same reasoning
 * already applied to this file's error path before this fix.
 *
 * Usage (run manually, after deploying this change, against the target
 * environment's MONGODB_URI):
 *   npm run migrate:kb-permissions -- --dry-run   # preview, no writes
 *   npm run migrate:kb-permissions                # apply
 */

export type KbPermissionsBackfillResult = {
  checked: number;
  changed: number;
  logLines: string[];
};

type RoleLike = {
  _id: unknown;
  orgId: unknown;
  permissions?: PermissionKey[];
};

/**
 * The minimal Mongoose Model surface this needs — kept as an explicit
 * interface (rather than importing Model<RoleDocument> here) so tests can
 * pass a plain jest-mocked object with no real Mongoose/Nest wiring,
 * exactly like kb-permissions-backfill.util.spec.ts already does for the
 * pure permission-set math this builds on.
 */
export type RoleModelLike = {
  find(filter: { name: string }): { lean(): Promise<RoleLike[]> };
  updateOne(filter: { _id: unknown }, update: unknown): Promise<unknown>;
};

/**
 * Pure orchestration over a role model — no process/exit-code/logger
 * concerns, so it's directly unit-testable. The CLI entrypoint (run(),
 * below) is a thin wrapper that bootstraps Nest, calls this, and prints
 * the returned lines with console.log.
 *
 * Idempotent by construction: a role already holding its full target
 * kb:* set contributes nothing to `changed` and triggers no write, dry-run
 * or not — running this twice in a row always makes the second run a
 * no-op. dry-run is enforced here, not just documented: the $addToSet
 * updateOne call is physically inside `if (!opts.dryRun)`.
 */
export async function runKbPermissionsBackfill(
  roleModel: RoleModelLike,
  opts: { dryRun: boolean },
): Promise<KbPermissionsBackfillResult> {
  let checked = 0;
  let changed = 0;
  const logLines: string[] = [];

  for (const roleName of COVERED_ROLE_NAMES) {
    const roles = await roleModel.find({ name: roleName }).lean();
    for (const role of roles) {
      checked += 1;
      const missing = computeKbPermissionGrants(roleName, role.permissions ?? []);
      if (missing.length === 0) continue;

      changed += 1;
      logLines.push(
        `${opts.dryRun ? '[dry-run] would grant' : 'granting'} [${missing.join(', ')}] to role "${roleName}" ` +
          `(org ${String(role.orgId)}, role ${String(role._id)})`,
      );
      if (!opts.dryRun) {
        await roleModel.updateOne(
          { _id: role._id },
          { $addToSet: { permissions: { $each: missing } } },
        );
      }
    }
  }

  logLines.push(
    `Checked ${checked} role document(s) named ${COVERED_ROLE_NAMES.join('/')}; ` +
      `${changed} ${opts.dryRun ? 'would be updated' : 'updated'}.`,
  );
  // Explicit, not merely implied by a "0" in the line above — an operator
  // scanning output for "did anything happen" should never have to parse
  // a count out of a sentence to find out.
  if (checked === 0) {
    logLines.push(
      `No role documents named ${COVERED_ROLE_NAMES.join('/')} were found in this database.`,
    );
  } else if (changed === 0) {
    logLines.push('No changes needed — every covered role already has its target kb:* permissions.');
  }

  return { checked, changed, logLines };
}

async function run() {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const roleModel = app.get<Model<RoleDocument>>(getModelToken(Role.name));
    const result = await runKbPermissionsBackfill(roleModel, { dryRun });

    // Deliberately console.log, not the Nest Logger class — see the file
    // doc comment above for why Logger would silently print nothing here.
    for (const line of result.logLines) {
      // eslint-disable-next-line no-console
      console.log(line);
    }
    if (!dryRun && result.changed > 0) {
      // eslint-disable-next-line no-console
      console.log(
        'Existing access tokens are unaffected until refresh — users pick up the new ' +
          'permissions on their next token refresh or next login (auth.service.ts already ' +
          're-reads the role document fresh on both refresh and login; no other change is needed).',
      );
    }
  } finally {
    await app.close();
  }
}

// Only runs when this file is executed directly as the CLI entrypoint
// (ts-node src/seed/backfill-kb-permissions.ts) — never as a side effect
// of a test importing runKbPermissionsBackfill.
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      // A CLI diagnostic tool run directly by an operator, not a server log
      // sink — the full error is what the person running it needs to see.
      // eslint-disable-next-line no-console
      console.error('Backfill failed:', err);
      process.exit(1);
    });
}
