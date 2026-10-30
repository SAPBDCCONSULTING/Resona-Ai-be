import {
  EXACT_GRANT_TO_LEGACY,
  GRANT_KEYS,
  legacyPermissionsForGrants,
} from '@pulsefeedback/shared';
import { effectivePermissions } from './effective-permissions';

describe('exact grant → legacy mapping', () => {
  it('only maps grants that exist in the registry', () => {
    for (const key of Object.keys(EXACT_GRANT_TO_LEGACY)) {
      expect(GRANT_KEYS).toContain(key);
    }
  });

  it('is exactly the six "Exact" rows of docs/rbac-legacy-mapping.md — nothing partial or ambiguous', () => {
    expect(EXACT_GRANT_TO_LEGACY).toEqual({
      'users.read': 'users:read',
      'roles.read': 'roles:read',
      'contacts.import': 'contacts:import',
      'sessions.launch': 'sessions:launch',
      'templates.read': 'templates:read',
      'ai.use': 'ai:use',
    });
  });

  it('never maps any write/administrative grant', () => {
    const mapped = new Set(Object.keys(EXACT_GRANT_TO_LEGACY));
    for (const key of [
      'roles.create',
      'roles.update',
      'roles.assign',
      'roles.delete',
      'org.update',
      'users.update',
      'users.invite',
      'users.deactivate',
      'contacts.create',
      'contacts.export',
      'sessions.create',
      'sessions.update',
      'programs.read',
    ]) {
      expect(mapped.has(key)).toBe(false);
    }
  });

  it('legacyPermissionsForGrants ignores unknown keys and de-duplicates', () => {
    expect(
      legacyPermissionsForGrants([
        'users.read',
        'users.read',
        'bogus',
        'org.update',
      ]),
    ).toEqual(['users:read']);
    expect(legacyPermissionsForGrants([])).toEqual([]);
  });
});

describe('effectivePermissions', () => {
  it('returns a system role’s stored legacy permissions untouched, ignoring any grants', () => {
    expect(
      effectivePermissions({
        permissions: ['org:read', 'roles:write'],
        grants: ['ai.use'],
      }),
    ).toEqual(['org:read', 'roles:write']);
  });

  it('returns the Owner’s stored legacy permissions', () => {
    expect(
      effectivePermissions({ kind: 'owner', permissions: ['org:write'] }),
    ).toEqual(['org:write']);
  });

  it('derives a custom role’s access only from exact-mapped grants and ignores stored permissions', () => {
    expect(
      effectivePermissions({
        kind: 'custom',
        permissions: ['org:write'], // must never be honoured for a custom role
        grants: ['users.read', 'roles.update', 'ai.use'],
      }),
    ).toEqual(['users:read', 'ai:use']);
    expect(
      effectivePermissions({ kind: 'custom', grants: ['roles.create'] }),
    ).toEqual([]);
  });

  it('fails closed for a missing role', () => {
    expect(effectivePermissions(null)).toEqual([]);
    expect(effectivePermissions(undefined)).toEqual([]);
  });
});
