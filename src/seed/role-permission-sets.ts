import type { PermissionKey } from '@pulsefeedback/shared';

/**
 * Single source of truth for each seeded role's target permission set.
 * Deliberately kept dependency-free (no Mongoose schema imports) so it can
 * be imported by both SeedService and any migration/backfill script or
 * test without pulling in the full schema module graph.
 */

export const ADMIN_PERMS: PermissionKey[] = [
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
  'kb:read',
  'kb:write',
  'kb:publish',
  'kb:archive',
  'kb:web_manage',
  'kb:web_ingest',
  'kb:collections_manage',
  'kb:feedback_manage',
  'kb:delete',
];

/** Read-only dashboard role — used to prove 403 on sessions:write. */
export const ANALYST_PERMS: PermissionKey[] = [
  'org:read',
  'contacts:read',
  'sessions:read',
  'campaigns:read',
  'templates:read',
  'reports:read',
  'settings:read',
  'kb:read',
];

/**
 * ai:use is included so an employee can submit AI-answer feedback
 * (POST /knowledge/feedback, gated at the route level by ai:use — see
 * KnowledgeFeedbackController) even though the employee one-on-one
 * discussion itself is reached via the separate responses:write-gated
 * conversation endpoints, not /api/ai/*. This does not expose any new
 * employee-facing UI for the dashboard-only /api/ai/* routes; it only
 * unblocks the feedback submission path employees are expected to use.
 */
export const EMPLOYEE_PERMS: PermissionKey[] = ['sessions:read', 'responses:write', 'ai:use'];
