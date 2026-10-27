import type { PermissionKey } from '@pulsefeedback/shared';

export const OWNER_ROLE_NAME = 'Owner';

/**
 * Legacy permissions held by the Owner role: every administrative permission. The only legacy key
 * left out is `responses:write`, a participant action (see docs/rbac-legacy-mapping.md, "Unmapped")
 * — the seeded Admin role omits it too. Owners hold ALL granular grants implicitly (see
 * RoleAuthorityService.grantsForRole), so there is nothing to configure for them.
 */
export const OWNER_LEGACY_PERMISSIONS: PermissionKey[] = [
  'org:read',
  'org:write',
  'users:read',
  'users:write',
  'roles:read',
  'roles:write',
  'contacts:read',
  'contacts:write',
  'contacts:import',
  'sessions:read',
  'sessions:write',
  'sessions:launch',
  'sessions:archive',
  'campaigns:read',
  'campaigns:write',
  'templates:read',
  'templates:write',
  'reports:read',
  'reports:export',
  'ai:use',
  'settings:read',
  'settings:write',
];
