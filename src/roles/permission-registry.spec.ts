import {
  GRANT_KEYS,
  GRANT_REGISTRY,
  REGISTRY_VERSION,
  ROLE_PROFILE_DEFS,
  getRoleProfileDef,
  isGrantKey,
  normalizeGrants,
} from '@pulsefeedback/shared';

describe('granular permission registry', () => {
  it('uses unique resource.action keys that match their parts', () => {
    expect(new Set(GRANT_KEYS).size).toBe(GRANT_KEYS.length);
    for (const g of GRANT_REGISTRY) {
      expect(g.key).toMatch(/^[a-z]+\.[a-z]+$/);
      expect(g.key).toBe(`${g.resource}.${g.action}`);
      expect(g.name.length).toBeGreaterThan(0);
      expect(g.description.length).toBeGreaterThan(0);
    }
  });

  it('contains every key explicitly supported by the specification', () => {
    const required = [
      'org.read',
      'org.update',
      'users.read',
      'users.invite',
      'users.update',
      'users.deactivate',
      'roles.read',
      'roles.create',
      'roles.update',
      'roles.assign',
      'roles.delete',
      'contacts.read',
      'contacts.create',
      'contacts.update',
      'contacts.import',
      'contacts.export',
      'sessions.read',
      'sessions.create',
      'sessions.update',
      'sessions.launch',
      'sessions.archive',
      'programs.read',
      'programs.create',
      'programs.update',
      'templates.read',
      'templates.create',
      'templates.update',
      'templates.publish',
      'reports.read',
      'reports.export',
      'ai.use',
    ];
    expect([...GRANT_KEYS].sort()).toEqual([...required].sort());
  });

  it('does not collide with legacy colon-style keys', () => {
    for (const k of GRANT_KEYS) expect(k).not.toContain(':');
  });

  it('validates keys strictly', () => {
    expect(isGrantKey('roles.read')).toBe(true);
    expect(isGrantKey('roles:read')).toBe(false); // legacy format is not a valid grant
    expect(isGrantKey('roles.fly')).toBe(false);
    expect(isGrantKey('__proto__')).toBe(false);
    expect(isGrantKey({ $gt: '' })).toBe(false);
    expect(isGrantKey(7)).toBe(false);
    expect(isGrantKey(undefined)).toBe(false);
  });

  it('normalizes: drops unknowns/duplicates, registry order', () => {
    expect(
      normalizeGrants(['sessions.read', 'nope', 'org.read', 'org.read']),
    ).toEqual(['org.read', 'sessions.read']);
  });

  it('exposes a stable-format registry version', () => {
    expect(REGISTRY_VERSION).toMatch(/^[0-9a-f]{8}$/);
  });

  it('defines the eight role profiles; only Admin/Analyst link to legacy roles', () => {
    expect(ROLE_PROFILE_DEFS.map((p) => p.profileKey)).toEqual([
      'owner',
      'admin',
      'hr-people-manager',
      'manager',
      'analyst',
      'facilitator',
      'viewer',
      'custom-role',
    ]);
    const linked = ROLE_PROFILE_DEFS.filter((p) => p.legacyRoleName).map(
      (p) => [p.profileKey, p.legacyRoleName],
    );
    expect(linked).toEqual([
      ['admin', 'Admin'],
      ['analyst', 'Analyst'],
    ]);
    expect(getRoleProfileDef('custom-role')?.kind).toBe('template');
    expect(getRoleProfileDef('nope')).toBeUndefined();
  });
});
