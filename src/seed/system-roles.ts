import type { PermissionKey } from '@pulsefeedback/shared';
import { OWNER_LEGACY_PERMISSIONS } from '../roles/owner-role';

/** Legacy permission sets of the built-in roles. The seed and the dev fixtures both use these. */
export const ADMIN_PERMS: PermissionKey[] = OWNER_LEGACY_PERMISSIONS;

/** Read-only dashboard role — used to prove 403 on sessions:write. */
export const ANALYST_PERMS: PermissionKey[] = [
  'org:read',
  'contacts:read',
  'sessions:read',
  'campaigns:read',
  'templates:read',
  'reports:read',
  'settings:read',
];

export const EMPLOYEE_PERMS: PermissionKey[] = [
  'sessions:read',
  'responses:write',
];
