import type { PermissionKey } from '@pulsefeedback/shared';
import { ADMIN_PERMS, ANALYST_PERMS } from './role-permission-sets';

/**
 * Which kb:* permissions a role named `roleName` should have, derived from
 * the same ADMIN_PERMS/ANALYST_PERMS arrays seed.service.ts already uses
 * for brand-new role documents — a single source of truth, so this can
 * never drift out of sync with what a fresh org's roles actually get.
 *
 * Only these two role names are covered. "Employee" is deliberately
 * excluded (EMPLOYEE_PERMS grants no kb:* permission — least privilege),
 * and so is any custom role name an org may have created: this backfill
 * never touches a role it doesn't explicitly recognize by name.
 */
const TARGET_KB_PERMS: Record<string, PermissionKey[]> = {
  Admin: ADMIN_PERMS.filter((p) => p.startsWith('kb:')),
  Analyst: ANALYST_PERMS.filter((p) => p.startsWith('kb:')),
};

export const COVERED_ROLE_NAMES = Object.keys(TARGET_KB_PERMS);

export function targetKbPermissionsForRole(roleName: string): PermissionKey[] {
  return TARGET_KB_PERMS[roleName] ?? [];
}

/**
 * Pure diff: which kb:* permissions `roleName` is missing, given its
 * current permissions array. Returns [] for a role name this backfill
 * doesn't cover — those are always left untouched, never granted anything.
 * Never removes a permission the role already has (additive only).
 */
export function computeKbPermissionGrants(
  roleName: string,
  currentPermissions: PermissionKey[],
): PermissionKey[] {
  const target = targetKbPermissionsForRole(roleName);
  if (target.length === 0) return [];
  const current = new Set(currentPermissions ?? []);
  return target.filter((p) => !current.has(p));
}
