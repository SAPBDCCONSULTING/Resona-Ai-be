import {
  legacyPermissionsForGrants,
  type PermissionKey,
} from '@pulsefeedback/shared';

interface RoleForPermissions {
  kind?: 'custom' | 'owner';
  permissions?: string[];
  grants?: string[];
}

/**
 * The legacy permissions a role confers RIGHT NOW. System roles (no `kind`, and Owner) use their
 * stored legacy `permissions` exactly as before. A custom role stores none; what it confers is
 * derived from its granular grants through the exact-mapping table only. Unmapped grants confer
 * nothing, so this can never widen a system role and never grants more than the grants say.
 */
export function effectivePermissions(
  role: RoleForPermissions | null | undefined,
): PermissionKey[] {
  if (!role) return [];
  if (role.kind === 'custom') {
    return legacyPermissionsForGrants(role.grants ?? []) as PermissionKey[];
  }
  return [...(role.permissions ?? [])] as PermissionKey[];
}
