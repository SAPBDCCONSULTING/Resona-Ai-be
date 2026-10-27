/**
 * Canonical granular permission registry + role profile definitions (Roles & Permissions, Stage 4).
 *
 * IDENTICAL COPIES live in resona-ai-be/shared/src and resona-ai-dashboard-fe/shared/src.
 * Edit both together; the API returns REGISTRY_VERSION so the dashboard can detect a mismatch.
 *
 * COMPATIBILITY — these "grants" are CONFIGURATION ONLY at this stage. They are stored separately
 * from the legacy `PermissionKey` list (`roles.permissions`, e.g. `roles:write`) which remains the
 * only thing the API enforces. No legacy-to-granular mapping is applied anywhere; see
 * docs/rbac-legacy-mapping.md for the proposed (unapproved) table reserved for Stage 6.
 */

export type GrantResource =
  | 'org'
  | 'users'
  | 'roles'
  | 'contacts'
  | 'sessions'
  | 'programs'
  | 'templates'
  | 'reports'
  | 'ai';

/**
 * standard  — ordinary capability.
 * sensitive — people data, exports or outward/irreversible actions.
 * protected — governance / Owner-level (changes who can do what). UI hint: never added by
 *             group selection. Classification is a placeholder pending the product spec.
 */
export type GrantSensitivity = 'standard' | 'sensitive' | 'protected';

export interface GrantDef {
  key: string;
  resource: GrantResource;
  action: string;
  name: string;
  description: string;
  sensitivity: GrantSensitivity;
}

export const GRANT_RESOURCE_LABELS: Record<GrantResource, string> = {
  org: 'Organization',
  users: 'Users',
  roles: 'Roles',
  contacts: 'Contacts',
  sessions: 'Sessions',
  programs: 'Programs',
  templates: 'Templates',
  reports: 'Reports',
  ai: 'AI Assistant',
};

/** Spec areas with no confirmed permission keys yet. */
export const UNREGISTERED_GRANT_AREAS = ['Knowledge Base', 'Settings & guardrails'] as const;

function def(
  resource: GrantResource,
  action: string,
  name: string,
  description: string,
  sensitivity: GrantSensitivity = 'standard',
): GrantDef {
  return { key: `${resource}.${action}`, resource, action, name, description, sensitivity };
}

export const GRANT_REGISTRY: readonly GrantDef[] = [
  def('org', 'read', 'View organization', 'See organization profile and settings.'),
  def('org', 'update', 'Update organization', 'Change organization profile and settings.', 'protected'),

  def('users', 'read', 'View users', 'See the list of users and their roles.'),
  def('users', 'invite', 'Invite users', 'Send invitations to join the organization.', 'sensitive'),
  def('users', 'update', 'Update users', 'Edit user details.', 'sensitive'),
  def('users', 'deactivate', 'Deactivate users', 'Remove a user’s access to the organization.', 'protected'),

  def('roles', 'read', 'View roles', 'See roles and their permissions.'),
  def('roles', 'create', 'Create roles', 'Define new custom roles.', 'protected'),
  def('roles', 'update', 'Update roles', 'Change the permissions of a role.', 'protected'),
  def('roles', 'assign', 'Assign roles', 'Assign roles to users.', 'protected'),
  def('roles', 'delete', 'Delete roles', 'Delete custom roles.', 'protected'),

  def('contacts', 'read', 'View contacts', 'See contacts and groups.'),
  def('contacts', 'create', 'Create contacts', 'Add new contacts.'),
  def('contacts', 'update', 'Update contacts', 'Edit existing contacts.'),
  def('contacts', 'import', 'Import contacts', 'Bulk-import contacts from a file.', 'sensitive'),
  def('contacts', 'export', 'Export contacts', 'Download contact data.', 'sensitive'),

  def('sessions', 'read', 'View sessions', 'See sessions and their progress.'),
  def('sessions', 'create', 'Create sessions', 'Create new sessions.'),
  def('sessions', 'update', 'Update sessions', 'Edit session setup.'),
  def('sessions', 'launch', 'Launch sessions', 'Start a session and invite participants.', 'sensitive'),
  def('sessions', 'archive', 'Archive sessions', 'Archive completed sessions.', 'sensitive'),

  def('programs', 'read', 'View programs', 'See programs.'),
  def('programs', 'create', 'Create programs', 'Create new programs.'),
  def('programs', 'update', 'Update programs', 'Edit existing programs.'),

  def('templates', 'read', 'View templates', 'See session templates.'),
  def('templates', 'create', 'Create templates', 'Create new templates.'),
  def('templates', 'update', 'Update templates', 'Edit existing templates.'),
  def('templates', 'publish', 'Publish templates', 'Make templates available to the organization.', 'sensitive'),

  def('reports', 'read', 'View reports', 'See reports and insights.'),
  def('reports', 'export', 'Export reports', 'Download report data.', 'sensitive'),

  def('ai', 'use', 'Use AI Assistant', 'Use the AI assistant.'),
];

export const GRANT_KEYS: readonly string[] = GRANT_REGISTRY.map((g) => g.key);

const GRANT_KEY_SET: ReadonlySet<string> = new Set(GRANT_KEYS);

export function isGrantKey(value: unknown): value is string {
  return typeof value === 'string' && GRANT_KEY_SET.has(value);
}

/** Drops unknown keys and duplicates, preserving registry order. */
export function normalizeGrants(keys: Iterable<string>): string[] {
  const set = new Set(keys);
  return GRANT_KEYS.filter((k) => set.has(k));
}

/** FNV-1a over the key list — changes whenever a key is added, removed or renamed. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const REGISTRY_VERSION: string = fnv1a(GRANT_KEYS.join('|'));

// ---- Role profiles --------------------------------------------------------------------------

export type RoleProfileKey =
  | 'owner'
  | 'admin'
  | 'hr-people-manager'
  | 'manager'
  | 'analyst'
  | 'facilitator'
  | 'viewer'
  | 'custom-role';

export interface RoleProfileDef {
  profileKey: RoleProfileKey;
  name: string;
  description: string;
  /** `template` = a pattern for roles users define themselves; not a role in its own right. */
  kind: 'system' | 'template';
  /**
   * Name of the pre-existing legacy role this profile is linked to, by EXACT name only.
   * Profiles without one have no legacy role, no users and are not assignable.
   */
  legacyRoleName?: 'Admin' | 'Analyst';
}

export const ROLE_PROFILE_DEFS: readonly RoleProfileDef[] = [
  {
    profileKey: 'owner',
    name: 'Owner',
    description: 'Full control of the organization, including billing, security and ownership transfer.',
    kind: 'system',
  },
  {
    profileKey: 'admin',
    name: 'Admin',
    description: 'Manages organization settings, users and roles day to day, without billing control.',
    kind: 'system',
    legacyRoleName: 'Admin',
  },
  {
    profileKey: 'hr-people-manager',
    name: 'HR / People Manager',
    description: 'Runs listening programs, campaigns and sessions across the people function.',
    kind: 'system',
  },
  {
    profileKey: 'manager',
    name: 'Manager',
    description: 'Views results and follows up on feedback for their own team.',
    kind: 'system',
  },
  {
    profileKey: 'analyst',
    name: 'Analyst',
    description: 'Explores reports and insights and exports data, with no session administration.',
    kind: 'system',
    legacyRoleName: 'Analyst',
  },
  {
    profileKey: 'facilitator',
    name: 'Facilitator',
    description: 'Prepares and conducts sessions and one-on-ones, and works with their contacts.',
    kind: 'system',
  },
  {
    profileKey: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to shared dashboards and reports.',
    kind: 'system',
  },
  {
    profileKey: 'custom-role',
    name: 'Custom Role',
    description: 'A role you define yourself by choosing exactly which permissions it includes.',
    kind: 'template',
  },
];

export function getRoleProfileDef(profileKey: string): RoleProfileDef | undefined {
  return ROLE_PROFILE_DEFS.find((p) => p.profileKey === profileKey);
}

// ---- API contract ---------------------------------------------------------------------------

export interface LegacyRoleSummary {
  id: string;
  name: string;
  /** Legacy `PermissionKey` values — the access the API actually enforces today. */
  permissions: string[];
  /** Real count of users in this organization whose roleId is this role. */
  userCount: number;
}

export interface RoleProfileConfig {
  grants: string[];
  version: number;
  updatedAt: string;
}

export interface RoleProfileItem {
  profileKey: RoleProfileKey;
  name: string;
  description: string;
  kind: 'system' | 'template';
  /** Linked pre-existing role (read-only context), or null when no legacy role exists. */
  legacyRole: LegacyRoleSummary | null;
  /** Saved granular configuration, or null if never configured. NOT enforced by the API yet. */
  config: RoleProfileConfig | null;
  /** True only when users can currently be assigned via the legacy role. */
  assignable: boolean;
  /** Real user count where a legacy role is linked; null (unavailable) otherwise. */
  userCount: number | null;
  editable: boolean;
  readOnlyReason: string | null;
}

export interface RoleProfilesResponse {
  registryVersion: string;
  items: RoleProfileItem[];
  /** Existing roles not linked to any profile (e.g. Employee), shown for transparency. */
  unlinkedLegacyRoles: LegacyRoleSummary[];
}

export interface UpdateRoleGrantsInput {
  grants: string[];
  /** 0 when the profile has never been saved; otherwise the version last loaded. */
  expectedVersion: number;
}

// ---- Custom roles (Stage 5) -----------------------------------------------------------------

/** Name rules shared by the API (authoritative) and the dashboard (UX only). */
export const CUSTOM_ROLE_NAME_MIN = 2;
export const CUSTOM_ROLE_NAME_MAX = 50;
export const CUSTOM_ROLE_DESCRIPTION_MAX = 500;
export const CUSTOM_ROLE_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _\-&.'/()]*$/u;

/** Collapses whitespace so "Team  Lead " and "Team Lead" are the same name. */
export function normalizeRoleName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export interface CustomRoleItem {
  id: string;
  name: string;
  description: string;
  /** Granular grants. Configuration only — a custom role adds NO legacy API permissions. */
  grants: string[];
  version: number;
  userCount: number;
  createdAt: string;
  updatedAt: string;
  editable: boolean;
  editBlockedReason: string | null;
  deletable: boolean;
  deleteBlockedReason: string | null;
}

export interface CustomRolesResponse {
  registryVersion: string;
  items: CustomRoleItem[];
  /** Grants the caller may delegate (their own role's configured grants). Others are locked. */
  delegableGrants: string[];
  canCreate: boolean;
  createBlockedReason: string | null;
}

export interface CreateCustomRoleInput {
  name: string;
  description: string;
  grants: string[];
}

export interface UpdateCustomRoleInput {
  name: string;
  description: string;
  grants: string[];
  /** The `version` last loaded by the client. */
  expectedVersion: number;
}

export interface AssignableRole {
  id: string;
  name: string;
  kind: 'system' | 'custom';
}

// ---- Enforcement for custom roles (Stage 6) -------------------------------------------------

/**
 * The ONLY granular grants that take effect, and only for CUSTOM roles. Each is a 1:1 match with a
 * legacy key that guards exactly the same operation (docs/rbac-legacy-mapping.md, "Exact" table).
 * Every other grant is stored configuration and confers no access. Do not add an entry here
 * without resolving its row in that document (Partial / Ambiguous rows are deliberately absent).
 * System roles (Admin, Analyst, Employee, Owner) are NOT affected by this table.
 */
export const EXACT_GRANT_TO_LEGACY: Readonly<Record<string, string>> = {
  'users.read': 'users:read',
  'roles.read': 'roles:read',
  'contacts.import': 'contacts:import',
  'sessions.launch': 'sessions:launch',
  'templates.read': 'templates:read',
  'ai.use': 'ai:use',
};

/** Legacy permissions a custom role's grants currently confer (exact mappings only). */
export function legacyPermissionsForGrants(grants: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const g of grants) {
    const legacy = EXACT_GRANT_TO_LEGACY[g];
    if (legacy) out.add(legacy);
  }
  return [...out];
}


/** What a grant that currently "takes effect" actually unlocks (verified against the controllers). */
export interface EnforcedCapability {
  legacyKey: string;
  routes: string[];
}

export const ENFORCED_CAPABILITIES: Readonly<Record<string, EnforcedCapability>> = {
  'users.read': { legacyKey: 'users:read', routes: ['GET /api/users'] },
  'roles.read': {
    legacyKey: 'roles:read',
    routes: ['GET /api/roles', 'GET /api/roles/profiles', 'GET /api/roles/custom'],
  },
  'contacts.import': { legacyKey: 'contacts:import', routes: ['POST /api/contacts/import'] },
  'sessions.launch': { legacyKey: 'sessions:launch', routes: ['POST /api/sessions/:id/launch'] },
  'templates.read': {
    legacyKey: 'templates:read',
    routes: ['GET /api/report-templates', 'GET /api/session-templates'],
  },
  'ai.use': {
    legacyKey: 'ai:use',
    routes: [
      'GET /api/ai/knowledge',
      'POST /api/ai/session-topics',
      'POST /api/ai/session-chat',
      'POST /api/ai/assistant-chat',
    ],
  },
};

/** Per-grant status for a role editor: configured vs actually enforced vs stored-only. */
export function classifyGrants(grants: Iterable<string>): {
  effective: string[];
  unmapped: string[];
} {
  const effective: string[] = [];
  const unmapped: string[] = [];
  for (const g of normalizeGrants(grants)) {
    (EXACT_GRANT_TO_LEGACY[g] ? effective : unmapped).push(g);
  }
  return { effective, unmapped };
}
